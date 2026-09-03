# チャットの Nostr イベントに NIP-70（Protected Events）を適用する (#460)

- 対象: `apps/web`（イベント組み立て・チャンネル作成フロー）、
  `apps/server`（kind:40 のリレー発行経路の新設・チャンネル API の統合）、
  `packages/shared`（入力スキーマ・文言）、`docs/staff-chat.md`（記述の同期）
- 前提: 書き込みリレー（既定の `wss://r.kojira.io` / `wss://x.kojira.io`、strfry）が
  **NIP-42 と NIP-70 に対応済み**（#460 の前提。#199 撤回時とはリレー側の状況が変わった）
- ステータス: **設計**（実装 PR で 9. に差分を追記する）

---

## 1. なぜやるか

チャットの封じ込めは現在「書き込みは自リレー2台限定＋NIP-42 AUTH」だけで担保している
（#199。NIP-70 は当時の strfry がコアで protected イベントを拒否したため撤回 `751634f`）。
この方式の穴は、**リレーに書かれた後**にある。イベント自体は正しく署名された公開データ
なので、読める第三者がコピーして他リレーへ再放流（rebroadcast）することを何も妨げない。

NIP-70 の `["-"]` タグは「このイベントは著者本人の AUTH 済み接続からしか受理するな」
という宣言で、対応リレーは第三者による持ち込みを拒否する。リレーが対応した今、
これを付け直すことで **他リレーへの流出（再放流の受理）を仕様レベルで拒否**できる。

なお NIP-70 が守るのは「書き込まれる側」であり、読み取りの制限ではない
（メタデータ露出の整理は `docs/staff-chat.md` §5 のまま。8. で同期する）。

---

## 2. 調査結果（既存の姿）

### 2.1 発行されるイベントと組み立て場所

| kind | 用途 | 組み立て | 署名 | リレーへの発行 |
|------|------|----------|------|----------------|
| 40 | チャンネル作成 | `routes/eventChat.ts`（公式鍵）/ `nostrChat.ts` `buildChannelCreateTemplate`（主催者 NIP-07） | 公式鍵 or 主催者鍵 | **参加者のブラウザ**（`EventChat.tsx` の `pool.publish(created)`） |
| 42 | イベントチャット発言 | `nostrChat.ts` `buildChannelMessageTemplate` | 発言者の鍵 | 発言者のブラウザ |
| 9807 | スタッフチャット発言 | `staffChatCrypto.ts` `sealStaffChatMessage` → **同じ `buildChannelMessageTemplate`** | 専用一時鍵 | 発言者のブラウザ |
| 27888 | 鍵の所有証明 | `nostrChat.ts` `buildChatKeyProofTemplate` | 発言者の鍵 | **発行しない**（API へ送るだけ） |
| 22242 | NIP-42 AUTH 応答 | nostr-tools（`ChatRelayPool` の `relay.onauth` / `relay.auth()`） | 接続者の鍵 | 保存されない（AUTH 専用） |

- kind:42 と 9807 は builder が 1 つに共有されているので、**タグ付与は 1 か所**で済む。
- kind:40 だけが「署名者（公式鍵）と発行接続（参加者）が別人」で、NIP-70 の
  「AUTH 済み pubkey ＝ イベントの pubkey」制約に反する。`EventChat.tsx:423-427` に
  このリスクの注記が既にある（リレー側の特例設定で運用する前提だった）。

### 2.2 kind:40 の現行フロー（3 段階・契約が 2 か所）

```
staff のブラウザ ── POST /:id/chat-channel/official ──→ サーバが署名して返す
      │                                                  （pending に id を控える）
      ├── pool.publish(kind:40) ──→ リレー（受理を確認）
      └── POST /:id/chat-channel ──→ サーバが検証して先勝ち登録
```

- `/chat-channel` の登録検証は「公式鍵署名＋pending 一致」または
  「主催者(createdBy)の登録済み鍵の署名」の 2 系統（`routes/eventChat.ts:313-333`）。
- 主催者が NIP-07 で参加している場合はブラウザが `buildChannelCreateTemplate` で
  自ら署名する分岐がある（`EventChat.tsx:412-419`）。
- `setPendingChannel` / `pendingChannelFor` は「クライアントに発行を委ねる」ための
  持ち込み防止装置（発行済み id 以外の登録を拒否 #221）。

### 2.3 サーバ側の部品

- `lib/nostrSign.ts` の `signWithServiceKey(template)`: 任意 kind の NIP-01 イベントを
  公式鍵で署名して返す。**kind 22242 の AUTH 応答にもそのまま使える**。
- `auth/nostr.ts` の `verifyNostrLogin`: kind 22242 に `challenge` タグ、という
  NIP-42 の形の検証実装が既にある。**発行側もこれと同じ形で組み立てる**。
- `db/repositories/appSettings.ts` の `getChatRelays()`: 実効リレー一覧。
  `wss://` のみ・最大 `CHAT_RELAY_MAX`(5) 件に正規化済み。

### 2.4 Cloudflare Workers の WebSocket クライアント（確認した事実）

- `new WebSocket(url)` は Workers で**使える**（公式 docs に記載あり。Close フレームへ
  自動応答する等の挙動注記つき）。標準の書き方は
  `fetch(url, { headers: { Upgrade: "websocket" } })` → `response.webSocket.accept()`。
- 同時接続の上限は **1 リクエストあたり 6**（「レスポンスヘッダ待ちの接続が同時 6 まで。
  outbound WebSocket もこの枠を消費する」）。7 本目はキュー待ちになる。
  `CHAT_RELAY_MAX` は 5 なので全リレー並列接続でも枠内。
- ネットワーク待ちは CPU 時間に数えられない。HTTP リクエスト処理中は接続を保持できる。
- **レスポンスを返した後**のタスクはキャンセルされうる（`ctx.waitUntil()` で最長 30 秒
  延命）。→ 本設計は「OK を待ってから HTTP レスポンスを返す」ので、成否判定の経路に
  `waitUntil` は不要。レスポンス前にソケットを閉じ切る（3.3）。
- 未確認の点は 10. にまとめた（`fetch()` に `wss://` を渡せるか、テスト環境
  （vitest-pool-workers / miniflare）で外向き WebSocket が動くか、など）。

---

## 3. 設計

### 3.1 タグの付与（kind:42 / 9807）: builder 1 か所に `["-"]`

`buildChannelMessageTemplate` の `tags` 先頭の `e` タグに続けて `["-"]` を足す。
kind:42（参加者チャット）と kind:9807（スタッフチャット。`sealStaffChatMessage` が
同じ builder を通る）の両方がこれ 1 か所で protected になる。

- 発言者は自分の鍵で NIP-42 AUTH してから発言する（`ChatRelayPool` 実装済み）ので、
  「AUTH 済み pubkey ＝ イベントの pubkey」は自然に満たす。**クライアント側の変更は
  タグ 1 つだけ**。
- kind 27888（所有証明）はリレーに発行しないので付けない。kind 22242（AUTH 応答）は
  リレーに保存されないので付けない（nostr-tools の組み立てのまま）。
- `nostrChat.ts` 冒頭の「NIP-70 は不採用」コメント（:18-19）を本ドキュメント参照に
  書き換える。

### 3.2 kind:40 はサーバ発行に一本化（API 統合）

kind:40 に `["-"]` を付けると、公式鍵署名のイベントは**公式鍵で AUTH した接続**から
しか受理されない。よって発行はサーバ（Workers）が行う。このとき現行の 3 段階フロー
（2.2）を保つ理由が消えるので、**チャンネル作成を 1 リクエストに統合**する。

```
staff のブラウザ ── POST /:id/chat-channel ──→ サーバ:
                                                1. 既存チャンネルがあればそれを返す（先勝ち）
                                                2. 公式鍵で kind:40 を署名（tags: [["-"]]）
                                                3. リレーへ WebSocket 接続・NIP-42 AUTH・EVENT 発行
                                                4. 1 台以上の OK を確認して DB へ先勝ち登録
                                                5. { channelId } を返す
```

**廃止するもの**（契約を 2 か所にしないため。持ち込み検証は「発行者がサーバ自身」に
なった時点で不要になる）:

- `POST /:id/chat-channel/official`（署名して返すだけの前段）
- `POST /:id/chat-channel` の**イベント受け取り型の登録**（`registerChatChannelInput` /
  `nostrEventInput` を受ける body、署名・pending・主催者鍵の検証一式）
- `setPendingChannel` / `pendingChannelFor`（リポジトリと列。マイグレーションで列を
  消すかは実装時に判断。残しても害はないが、読む人が迷うので消す方向）
- **主催者 NIP-07 によるクライアント署名・発行の分岐**（`buildChannelCreateTemplate`、
  `EventChat.tsx` の `organizerNip07` 分岐、`/chat-channel` の createdBy 鍵検証）。
  NIP-70 の制約上はこの分岐だけ技術的に残せる（主催者自身の AUTH 接続から発行できる）
  が、発行経路が 2 本になり、片方はブラウザ・片方はサーバという最悪の形の二重契約に
  なるのでやめる。チャンネルの署名者が公式鍵に揃うことは「鍵の持ち主が消えると
  チャンネル管理者が不在になる」問題（#199 の当初動機）の解でもある

**残すもの**:

- `POST /:id/chat-channel` の入口条件はそのまま: `requireEventRole(["staff"])` ＋
  `staffAndNotBlocked` ＋ `chatEnabled && status === "published"`（公式鍵の署名オラクル
  化防止 #221）＋ `serviceKeyConfigured()`。
- `DELETE /:id/chat-channel`（作り直し）と監査ログ。:343 のコメントは「NIP-70 時代に
  リレーへ保存されなかった kind:40 の復旧用」から「リレー側の消失・作り直し一般の
  復旧用」に書き換える（新フローでは受理確認後に登録するため、旧来の主因は消える）。
- 先勝ちの決着は従来どおり `setChannelOnce`。同時に 2 人の staff が押したレースでは
  2 つの kind:40 がリレーに載り、DB に登録された方だけが使われる。負けた方は
  リレー上の無害な孤児（現行フローでも同じことが起きる。kind:40 は購読対象ではなく、
  channelId は常にサーバから配られるので実害がない）。

**HTTP 契約**（`POST /:id/chat-channel`。body 無し）:

| 応答 | 条件 |
|------|------|
| `200 { channelId }` | 既存チャンネルあり（発行せず既存を返す）、または発行して 1 台以上のリレーが OK |
| `409 { error: "chat_disabled" }` | チャット無効 or 未公開（既存の `/official` と同じ） |
| `503 { error: "service_key_unset" }` | 公式鍵未設定（既存と同じ） |
| `502 { error: "relay_publish_failed", relays: [{ url, outcome, message? }] }` | **全リレーが失敗**。`outcome` は `"rejected"`（OK false。NIP-70 非対応リレーの拒否もここ）/ `"unreachable"`（接続失敗）/ `"timeout"` |

- 1 台でも OK なら成功（`ChatRelayPool.publish` と同じ判定）。失敗リレーの内訳は
  ログに残すだけで、成功応答には含めない。
- 502 の `relays` は staff 向けのデバッグ情報。リレー URL は `chat-members` API で
  参加者にも配っている公開値なので、返して問題ない。
- **タグ無しでの再送（非対応リレーへのフォールバック）はしない**。流出防止が目的なので、
  protected を受理できないリレーへは書かないのが正しい（issue の判断済み事項）。
- web 側の文言は既存キーを流用: 503 → `chatChannelCreateNoServiceKey`、
  502 → `chatChannelCreateRejected`（「リレーに受け付けられなかった」の意で一致）、
  その他 → `chatChannelCreateFailed`。

### 3.3 Workers からのリレー発行: `apps/server/src/lib/nostrRelay.ts`（新設）

リレーとの WebSocket 会話を 1 モジュールに閉じる。`routes/eventChat.ts` からは
オブジェクト経由で呼ぶ（テストで `vi.spyOn` できる形。リポジトリ層と同じ流儀）。

```ts
export const nostrRelay = {
  /** 署名済みイベントを全リレーへ並列発行。1台以上の OK で成功 */
  publishToRelays(
    relayUrls: readonly string[],   // 呼び出し側は必ず getChatRelays() の値を渡す
    event: NostrEvent,
    signAuth: (template: { kind; created_at; tags; content }) => NostrEvent,
  ): Promise<PublishReport>,        // { ok: boolean, relays: RelayOutcome[] }
};
```

**接続方式**: `new WebSocket(url)` を使う（Workers 対応を docs で確認済み。2.4）。
`wss://` の URL をそのまま渡せて、half-open 等の細かい制御（`fetch` + `accept()` が
必要になる理由）はこの用途に不要。発行して閉じるだけの短命接続なので、Close フレーム
自動応答の挙動も問題にならない。もし実機（staging）で workerd の制約に当たったら
`fetch(httpsUrl, { headers: { Upgrade: "websocket" } })` + `response.webSocket.accept()`
へ差し替える（その場合 `wss://` → `https://` の scheme 変換が要る。10. 参照）。

**1 リレーあたりの会話（状態機械）**:

```
接続 open
  → ["EVENT", event] を送る
  ← ["AUTH", challenge] はいつ届いてもよい（strfry は接続直後に送ることがある）。
     届いたら challenge を保持する
  ← ["OK", event.id, true, ...]   → 成功
  ← ["OK", event.id, false, "auth-required: ..."]
       → challenge があれば kind 22242 を signAuth で署名して ["AUTH", signed] を送り、
         ["OK", <22242のid>, true] を待ってから ["EVENT", event] を 1 回だけ再送
       → challenge がまだ無ければ AUTH メッセージの到着を待つ（全体の期限内で）
  ← ["OK", event.id, false, その他] → rejected（再送しない）
```

- AUTH 後の再送は **1 回だけ**（`ChatRelayPool.publish` の auth-required リトライと
  同じ考え方。AUTH 済みでも拒否し続けるリレーで無限ループしない）。
- kind 22242 の組み立ては `auth/nostr.ts` の検証（`verifyNostrLogin`）と同じ形:
  `kind: 22242, tags: [["relay", url], ["challenge", challenge]], content: ""`。
  署名は `signWithServiceKey` を**そのまま再利用**する（署名コードを増やさない）。
  AUTH イベントに `["-"]` は付けない（保存されないイベントのため）。

**タイムアウトと並列制御**:

| 定数 | 値 | 対象 |
|------|-----|------|
| `RELAY_CONNECT_TIMEOUT_MS` | 5_000 | WebSocket open まで |
| `RELAY_PUBLISH_TIMEOUT_MS` | 10_000 | 1 リレーの接続〜OK までの総予算（AUTH 往復込み） |
| `RELAY_SETTLE_GRACE_MS` | 2_000 | 最初の OK が出た後、残りのリレーを待つ猶予 |

- 全リレーへ**並列**に接続する（`CHAT_RELAY_MAX`=5 ≦ 同時接続上限 6）。
- 判定は「全リレーが settle」または「最初の OK から `RELAY_SETTLE_GRACE_MS` 経過」の
  早い方。**落ちているリレー 1 台のために全体を 10 秒待たせない**（片方が 300ms で
  OK したら、もう片方には最大 2 秒だけ猶予を与えて打ち切る）。打ち切った接続は close
  する（そのリレーの outcome は `"timeout"`）。
- 成否判定は HTTP レスポンスを返す**前**に完了し、ソケットも閉じてから返す。
  レスポンス後に生かしておく仕事が無いので `ctx.waitUntil` は使わない（2.4 の
  「レスポンス後のタスクはキャンセルされうる」制約をそもそも踏まない構造にする）。

**セキュリティ**: 接続先 URL は `getChatRelays()` の戻り値**だけ**を使う。
リクエストのパラメータ・body からリレー URL を一切受け取らない（Workers からの
任意 URL への WebSocket は SSRF になるため）。`getChatRelays()` は管理者設定由来で
`wss://`（`CHAT_RELAY_URL_PATTERN`）のみに正規化済み。この契約は
`nostrRelay.publishToRelays` の呼び出し側（route）に閉じ、URL を組み立てる口を作らない。

### 3.4 既存チャンネル・既存メッセージの扱い

**DB に登録済みの kind:40（`["-"]` 無し）はそのまま有効。再発行しない。**

- channelId はイベントの購読フィルタ（`"#e": [channelId]`）そのものなので、作り直すと
  **全員の画面から過去の発言が消える**（`DELETE /chat-channel` が監査ログ対象なのは
  このため）。流出防止の利得（作成イベント 1 件の再放流を拒否できる。中身はイベント
  題名と固定文言だけで、公開イベントのページに既に載っている情報）に対して代償が
  大きすぎる。
- 既存の kind:42 / 9807 も同様に触らない（署名済みイベントのタグは後から変えられない。
  NIP-70 は**これから発行する分**の再放流を防ぐ前向きの防御）。

### 3.5 管理者のカスタムリレー設定 UI

`AdminSettingsPage.tsx` のチャットリレー説明文に要件を 1 文足す:

> カスタムリレーは NIP-42（接続認証）と NIP-70（保護イベント）への対応が必須です。
> 対応していないリレーでは、チャンネルの開設や発言の書き込みが拒否されます。

- 管理者・スタッフ向け画面なので技術名（NIP-42/NIP-70）をそのまま書いてよい
  （「UI に技術名を出さない」方針は参加者向け文言のルール）。
- 文言は ja/en の両方を用意する。`AdminSettingsPage` は現状 ja ハードコードで
  `useTranslation` を使っていないため、新しい文だけ共有辞書
  （`packages/shared/src/i18n/messages/` に `adminSettings.ts` を新設）経由にする。
  ページ全体の i18n 化は本件のスコープ外（やるなら別 issue）。

### 3.6 サーバ発行を選んだ理由（捨てた代替案）

| 案 | 捨てた理由 |
|----|-----------|
| リレー側に「公式鍵のイベントは誰の接続からでも受理」の特例を入れる（現行コメント `EventChat.tsx:423` の運用案） | 封じ込めの契約がアプリの外（リレー設定）に漏れる。カスタムリレー運用者に同じ特例を要求することになり、素の NIP-42/70 対応だけで動く、という 3.5 の要件文が書けなくなる |
| kind:40 だけ `["-"]` を付けない | 「発行するチャット関連イベントすべてに付ける」という issue の決定に反する。チャンネル作成イベントだけ他リレーへ運べる状態が残る |
| 主催者 NIP-07 のクライアント発行を残す | 発行経路が 2 本（ブラウザ／サーバ）になる。3.2 のとおり廃止 |

---

## 4. テスト方針

### 4.1 server（vitest-pool-workers / workerd 内）

外向きの実 WebSocket はテスト環境で張らない（外部依存・未確認事項 10. を踏まない）。
2 層に分けてモック境界を最小にする:

1. **route テスト**（`test/event-chat.test.ts` の改修）:
   `vi.spyOn(nostrRelay, "publishToRelays")` で成功／全滅を差し替え
   （`event-broadcast.test.ts` が `notificationsRepo` でやっている既存の流儀）。
   - `POST /chat-channel` 成功 → 200・channelId 登録・**渡された event の
     `tags` が `[["-"]]`**・kind 40・公式鍵署名（既存 :989 周辺の断言
     `expect(channelEvent.tags).toEqual([])` はこの形に置き換え）
   - 全滅 → 502 `relay_publish_failed`・**DB に登録されない**（受理確認前に登録しない
     不変条件）
   - 既存チャンネルあり → 発行せず（spy が呼ばれない）既存 id を返す
   - `/chat-channel/official` と旧登録 body の**廃止確認**（404 / 400 になること）
   - 権限・chat_disabled・service_key_unset は既存ケースを流用
2. **プロトコル単体テスト**（`test/nostr-relay.test.ts` 新設）:
   `nostrRelay` 内部の 1 リレー会話ロジックを、WebSocket 互換の最小インターフェース
   （`send` / `close` / イベントハンドラ）を実装したフェイクに対して検証する。
   実装側はソケット生成だけを薄い工場関数に分離し、会話ロジックは
   「ソケットらしきもの」を受け取る形にする（プロダクションコードにテスト用フックは
   入れない。差し替え点は module 内の関数分割だけ）。
   - OK true 即応 / AUTH 先行→EVENT / EVENT→auth-required→AUTH→再送→OK /
     auth-required 再送後も拒否（1 回で打ち切り）/ 接続タイムアウト /
     片方 OK・片方無応答（grace で打ち切り、全体は成功）
   - 22242 の組み立てが `verifyNostrLogin` の期待する形であること（relay/challenge タグ）

   フェイクリレーを Durable Object やローカル ws サーバで立てる案は捨てた:
   workerd テストから自分自身へ外向き WebSocket を張る経路が未確認（10.）で、
   確認コストに見合う追加の保証（結局フェイクはフェイク）が無い。
   実リレーとの噛み合わせは staging の実機確認（6.5 工程）で見る。

### 4.2 web

- `apps/web/src/lib/nostrChat.test.ts` **新設**: `buildChannelMessageTemplate` の tags に
  `["-"]` と e タグが両方あること（kind 42 既定と kind 指定の両方）。
  `buildChatKeyProofTemplate` に `["-"]` が**無い**こと（リレーへ出ないイベント）。
- `apps/web/src/lib/staffChatCrypto.test.ts`: `sealStaffChatMessage` の tags 断言を
  `["-"]` 込みに更新（kind 9807 も protected になることの回帰テスト）。

### 4.3 実機確認（staging）

- staff で部屋を開設 → 200 と channelId、リレー上に `["-"]` 付き kind:40 がある
  （`nak req` 等で確認）
- 発言（kind:42）→ リレー上のイベントに `["-"]` がある
- 別の鍵で AUTH した接続からそのイベントを再 EVENT → OK false で拒否される（NIP-70 の
  効き目の確認）
- リレー 1 台を止めた状態で開設 → 数秒内に 200（grace 打ち切りの確認）

---

## 5. 実装手順（PR 分割）

1 PR で出せる規模だが、レビューと実機確認の単位で 2 つに割る:

1. **PR-1: サーバ発行経路と API 統合**（server + shared）
   - `lib/nostrRelay.ts` 新設、`POST /chat-channel` の統合・`/official` と pending の
     廃止、`registerChatChannelInput` / `OfficialChannelPayload` の削除、
     kind:40 の `tags: [["-"]]`、route/プロトコルのテスト
2. **PR-2: web の追随と文言・docs 同期**（web + shared + docs）
   - `buildChannelMessageTemplate` に `["-"]`、`EventChat.tsx` のフロー単純化
     （`organizerNip07` 分岐・`createOfficialChannelEvent`・`registerChannel` の削除）、
     `nostrChat.ts` 冒頭コメント、管理者 UI の文言（ja/en）、web テスト、
     `docs/staff-chat.md`・README・本ドキュメントの同期（8.）

PR-1 だけが本番に居る期間は、web は旧 API（`/official`→publish→登録）を呼んで 404 に
なるためチャンネル**新規開設**だけが一時的に失敗する（既存チャンネルの読み書きは無傷）。
staging で PR-1・PR-2 を連続で確認してから本番へまとめて出す（本番反映はユーザー GO 後）。

---

## 6. 影響範囲まとめ

| 場所 | 変更 |
|------|------|
| `apps/web/src/lib/nostrChat.ts` | `buildChannelMessageTemplate` に `["-"]`。`buildChannelCreateTemplate` 削除。冒頭コメント更新 |
| `apps/web/src/components/EventChat.tsx` | チャンネル作成を `POST /chat-channel` 1 発に単純化（分岐 2 つと publish 前後の手順が消え、953 行の超過ファイルが少し痩せる） |
| `apps/web/src/api/eventChatHooks.ts` | `createOfficialChannelEvent` 削除、`useRegisterChatChannel` → `useCreateChatChannel`（body 無し） |
| `apps/web/src/pages/AdminSettingsPage.tsx` | リレー要件の 1 文（i18n キー経由） |
| `apps/server/src/lib/nostrRelay.ts` | **新設**。WebSocket 発行・NIP-42 AUTH・タイムアウト |
| `apps/server/src/routes/eventChat.ts` | `/chat-channel` 統合・`/official` 廃止・:343 コメント更新 |
| `apps/server/src/db/repositories/eventChat.ts` | `setPendingChannel` / `pendingChannelFor` 削除（列の削除は実装時判断） |
| `packages/shared/src/eventChat.ts` | `registerChatChannelInput` / `OfficialChannelPayload` 削除 |
| `packages/shared/src/i18n/messages/` | `adminSettings.ts` 新設（ja/en） |
| テスト | 4. のとおり |
| `docs/staff-chat.md` / `README.md` | 8. のとおり |

---

## 7. やらないこと

- 非対応リレーへのフォールバック（タグ無し再送）。拒否は失敗として返す
- 既存イベント（kind:40/42/9807）の再発行・遡及的なタグ付け（3.4）
- 読み取り側の制限（NIP-70 は書き込み側の防御。読みの制御はリレーの AUTH 設定の領分）
- `AdminSettingsPage` 全体の i18n 化（新しい 1 文だけ辞書経由にする）
- リレーの死活監視・ヘルスチェック API（発行時の並列接続と grace 打ち切りで足りる）

---

## 8. docs/staff-chat.md ほかの改訂（実装 PR-2 で同期）

- `docs/staff-chat.md:39`「NIP-70 は strfry がコアで拒否するため不採用」→
  「NIP-70 を適用（#460。本ドキュメント参照）。封じ込めは自リレー2台限定＋NIP-42 に
  加えて、対応リレーによる第三者持ち込み拒否」へ。
- 同 §5.2 のメタデータ表: 「リレー上で第三者に見えるもの」の各行は**変わらない**
  （NIP-70 は読み取りを制限しない）。緩和策の列に「`["-"]` により対応リレーへの
  再放流は拒否される（コピーの再配布先を仕様が拒む）」を追記。
- 同 §12「リレー側の変更（relay29・NIP-70 等）。素の strfry のまま」→ NIP-70 の記述を
  外す（リレーが対応済みになり前提が変わった）。
- `README.md` の `NOSTR_SERVICE_KEY` 節: 「主催者本人が NIP-07 で署名する場合を除き」を
  削除し、kind:40 は常にサーバ発行である旨と、リレーの NIP-42/NIP-70 対応要件を追記。

---

## 9. 設計からの差分（実装・レビューで変えた判断）

（実装 PR で追記する）

---

## 10. 未確認の点（実装の最初に確認する）

1. **workerd の `new WebSocket(url)` で `wss://` の外部リレーに繋がるか**（本番 Workers
   と、ローカル `wrangler dev` の両方）。docs でコンストラクタの存在は確認済みだが、
   実接続は smoke していない。ダメなら `fetch(https…, { Upgrade })` + `accept()` へ
   差し替え（3.3 に退路を書いた。`fetch()` が `wss://` scheme を受けない点も
   このとき併せて確認する）。
2. **strfry が AUTH チャレンジを接続直後に送るか、要求時のみか**。状態機械（3.3）は
   どちらでも動く形にしてあるが、実機ログで確認して doc に残す。
3. **vitest-pool-workers 内で `new WebSocket` がどう振る舞うか**。4.1 はソケットを
   フェイクに差し替える方針なので依存はしないが、工場関数の分離位置に影響する。
