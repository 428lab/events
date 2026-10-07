# 参加者チャットを参加者だけに限定する（暗号化）(#582, D-PCHAT)

- 対象: `apps/server`（設定列・グループチャットの audience 追加・鍵配布 API・遅延ローテーション・
  公開範囲ゲート）、`packages/shared`（型・入力スキーマ・文言）、`apps/web`（設定 UI・
  EventChat の暗号化経路・ビンゴ併設・配信画面 #562・運営のモデレーション画面）
- 前提: スタッフチャット (#382, `docs/staff-chat.md`) と NIP-70 (#460, `docs/nip70-protected-chat.md`)、
  非公開・限定公開イベント (`docs/private-events.md`) は**マージ済み**
- 大枠はオーナー合意済み（Issue #582 本文）。本書はその大枠を最小の実装に落とすための決定集
- ステータス: **設計（未実装）**。オーナー確認後に実装する

---

## 0. 結論（要約）

| 項目 | 決定 |
|---|---|
| 設定の置き場所 | `event.chat_encrypted`（＋オンにした時刻 `chat_encrypted_at`）。staff がイベント編集で切り替える |
| 後から変えられるか | **いつでもオンにできる。オフには戻せない**（公開イベントでも）。オンの時点以降の発言だけ暗号化し、それまでの平文は（公開イベントでは）そのまま見える |
| 非公開・限定公開 | **チャットを使うなら暗号化オンが必須**。暗号化オフの非公開イベントは従来どおり参加者チャット停止 |
| 仕組み | スタッフチャットの3表・NIP-44・kind 9807・pull 配布を **audience 列で一般化**（`'staff'` に `'members'` を足す）。暗号処理は増やさない |
| 鍵を受け取れる人 | そのイベントの `status='confirmed'` メンバー（participant / staff / judge / observer）で、締め出し (#283) 中でない、退会申請中でない人。appAdmin・コミュニティ管理者のバイパスは**通さない** |
| ローテーション | **遅延（lazy）**: 鍵一式の取得のたびにサーバーが「資格を失った現役 signer」を照合し、居れば失効＋1世代進める。送信の直前に必ず取得し直す。退会（申請・purge）だけは即時にも回す |
| 人数上限 | **設けない**（根拠は 3.4。必要ならオーナー判断で後から足す） |
| 配信画面・OBS | スタッフのログイン済みブラウザが自分の資格で鍵一式を取得して復号する |
| マイグレーション | `0101_participant_encrypted_chat.sql` |

---

## 1. 設定（決めること 1）

### 1.1 置き場所

`event` 表に2列を足し、`Event` に `chatEncrypted: boolean` を載せる。

```sql
ALTER TABLE event ADD COLUMN chat_encrypted INTEGER NOT NULL DEFAULT 0;
-- オンにした時刻（ms）。平文の過去ログを「この時刻まで」に絞る表示判定に使う（4.2）
ALTER TABLE event ADD COLUMN chat_encrypted_at INTEGER;
```

- スタッフチャットは「部屋の存在」をイベント行に同居させない方針だった（staff-chat.md 6）。
  今回の列は**部屋の存在ではなく、参加者に見せる設定**（チャットの形式）なので event 表でよい。
  roomId・鍵・signer は従来どおり別表にしか無い
- `chatEnabled` と同じく**イベント編集でのみ設定**する（`updateEventInput` に `chatEncrypted` を追加。
  作成入力には入れない）。権限は既存のイベント編集（`PATCH /events/:id`）のまま
- 複製 (`routes/eventDuplicate.ts`) は `chatEnabled` と同じく値を引き継ぐ。`chat_encrypted_at` は
  複製先では複製時刻にする（複製先に平文の過去ログは無いので実害は無いが、NULL のままにしない）

### 1.2 切り替えの規則（サーバーで正規化する）

| 操作 | 結果 |
|---|---|
| オフ → オン | 常に可。`chat_encrypted_at = now`。以後の新しい発言は暗号化 |
| オン → オフ | **不可**（409 `chat_encrypted_locked`）。公開イベントでも同じ |
| 非公開・限定公開で `chatEnabled=true` を保存 | `chatEncrypted=true` も同時に必要。片方だけなら 400 |
| 公開 → 非公開・限定公開（暗号化オン） | `chatEnabled` を**維持**（暗号化チャットは続く） |
| 公開 → 非公開・限定公開（暗号化オフ） | 従来どおり `chatEnabled=false`（平文チャット停止） |

`events.ts` の正規化（`toEvent` と `update` の `visibility === "public" && chatEnabled`）は
`(visibility === "public" || chatEncrypted) && chatEnabled` に置き換える。
`eventMembers.ts` の要約行（`chatEnabled: chat_enabled === 1`）も同じ式に揃える。

**オフに戻せない理由**: 「参加者だけが読める」と案内されて書いた人の後続の発言が、
設定1つで外部から読める平文に戻るのは約束違反になる。戻す必要がある場面（外部クライアントで
読みたい等）は想定されておらず、戻せる口を作ると非公開イベントとの整合（非公開では常にオン）
の条件も増える。公開イベントでも一方向にして、規則を「オンにしたら最後まで暗号化」1本にする。

---

## 2. 再利用と一般化（決めること 2）

### 2.1 方針: 3表と鍵配布を audience で一般化する。暗号処理は複製しない

スタッフチャットは最初から #205 が乗る前提で `audience` 列を持っている（0075 のコメント）。
新しい表・新しい kind は作らない。

| 部品 | いま | 変更 |
|---|---|---|
| 表 `event_group_chat_room/key/signer` | `audience IN ('staff')` | `audience IN ('staff','members')`（0101 で作り直し。6.） |
| リポジトリ `db/repositories/staffChat.ts` (`staffChatRepo`) | `'staff'` 固定の SQL | `db/repositories/groupChat.ts` (`groupChatRepo`) に**改名**し、各関数に `audience: GroupChatAudience` 引数を足す。staff ルートは `'staff'` を渡すだけ |
| 型 `StaffChatKey / StaffChatMember / StaffChatPayload`（shared） | staff 専用名 | `GroupChatKey / GroupChatMember / GroupChatPayload` に改名（`packages/shared/src/groupChat.ts`）。中身は同じ。参加者向けは `EncryptedChatPayload`（2.3）が拡張する |
| 暗号 `apps/web/src/lib/staffChatCrypto.ts` | seal/open/latestKey/visibleAfterRevocation | `groupChatCrypto.ts` に改名するだけ（関数名も `sealGroupChatMessage` / `openGroupChatMessage`）。中身は変えない |
| kind | 9807 | 同じ 9807。部屋は roomId（e タグ）で分かれる |
| SQL 監査 `test/staff-chat-sql-audit.test.ts` | staffChat.ts の外を禁止 | 対象ファイル名を `groupChat.ts` に変える（3表を触る SQL はこの1ファイルだけ、という不変条件は同じ） |

- 改名は機械的な置換に限る。**スタッフチャットの挙動・API パス・レスポンス形は一切変えない**
  （`/api/events/:id/staff-chat` の GET/POST、403 一律、即時ローテーションの4経路はそのまま）。
  `staff-chat.test.ts` / `StaffChat.test.tsx` / `staffChatCrypto.test.ts`（改名後）が無修正の
  期待値で緑であることを受け入れ条件にする
- 改名をやめて `staffChatRepo` に `'members'` を通す案は捨てた。「スタッフチャットのリポジトリが
  参加者の鍵を配る」は名前と中身が食い違い、SQL 監査の文面（参加者に1行も返さない）とも矛盾する

### 2.2 新しいルート（`apps/server/src/routes/encryptedChat.ts`）

スタッフ部屋のルートには足さない（ゲートが違う）。平文の `eventChat.ts` にも足さない
（あちらは非公開イベントでは入口ごと 403 のミドルウェアを持つ。5.1）。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/events/:id/encrypted-chat` | ゲート（2.4）を通れば、まず**遅延ローテーション**（3.2）を行ってから payload を返す。部屋が無ければ 404。`myKey` は自分の signer が現役のときだけ |
| POST | `/api/events/:id/encrypted-chat` | 部屋・v1・自分の signer を無ければ作る（先勝ち・冪等。staff と同じ）。失効中の signer は再有効化。その後 GET と同じ payload |

- ゲート不通過は一律 403 `chat_unavailable`（既存の参加者チャットの停止応答に揃える。
  スタッフ部屋と違い、部屋の存在は秘密ではない＝`chatEncrypted` は Event に載っている）
- `Cache-Control: no-store`
- 監査用の書き込みガード（`EventWriter`、#private-events の batch guard）は既存の
  `addEphemeral` と同じ `permission:"chat-member"` を通す

### 2.3 payload

```ts
// packages/shared/src/groupChat.ts
export type GroupChatAudience = "staff" | "members";
export interface EncryptedChatMember extends GroupChatMember {
  /** イベントでのロール（staff の発言の色分け #228）。行が無ければ null */
  role: string | null;
}
export interface EncryptedChatPayload {
  roomId: string;
  keys: GroupChatKey[];
  myKey: { pubkey: string; secret: string } | null;
  /** revokedAt 付きの人も返す（過去の発言の名前解決のため） */
  members: EncryptedChatMember[];
  /** スタッフ・運営の非表示 (#278)。note id は平文・暗号文で共通の表 event_chat_hidden */
  hiddenNoteIds: string[];
  /** 平文の過去ログ（公開イベントのみ。非公開では常に null。4.2） */
  plaintextChannelId: string | null;
  /** この時刻（ms）より後の平文 kind 42 は表示しない */
  encryptedAt: number;
  relays: string[];
}
```

`members` は「その部屋に signer を持つ人」（staff 部屋と同じ `listMembers`）に、
`event_member.role` を LEFT JOIN で足したもの。平文側の `chat-members` の許可リストは
暗号化モードでは使わない（4.2 の平文過去ログの名前解決だけに使う）。

### 2.4 ゲート（鍵を受け取れる人）

`isEncryptedChatEligible(eventId, userId)`（`groupChatRepo` に SQL を置く）:

1. イベント: `chat_encrypted = 1` かつ（正規化後の）`chatEnabled` かつ `status = 'published'`
   かつ日程確定（`scheduling = 0`）。既存 `chat-members` の公開・日程条件と同じ
2. 本人: `event_member.status = 'confirmed'` かつ `role IN ('participant','staff','judge','observer')`
3. 本人: `user.deleted_at IS NULL`
4. 本人: 締め出し (#283) 中でない。**人単位**で、平文の鍵（`event_chat_key`）と
   暗号化部屋の signer のどちらの pubkey で締め出されていても該当（3.3）
5. イベント閲覧の門（`canViewEvent`、private の閲覧権）を通る。2 を満たす人は private の
   承諾済み閲覧権を持つので実質重複だが、他の子コンテンツと同じく「閲覧 AND 子条件」にする

既存の参加者チャットのゲート（`requireEventRole(MEMBER_ROLES)` ＋ `confirmedOnly` ＋ `notBlocked`）
との差は1点: **appAdmin とコミュニティ管理者のバイパスを通さない**。
- 遅延ローテーションは「現役 signer の持ち主がいまもゲートを通るか」を SQL 1本で照合する（3.2）。
  コミュニティ管理者の資格はコミュニティ側の変更で失われ、イベント側の SQL で追えない
- スタッフチャットと同じ「イベント配下は myRole で判定」(#275)。必要ならそのイベントの staff に入る
- 運営（appAdmin）のモデレーション画面は別経路で鍵を受け取る（4.5）

---

## 3. ローテーション（決めること 3）

### 3.1 資格を失う経路（列挙）

| 経路 | 場所 |
|---|---|
| 本人の参加取消（canceled / 行削除） | `membershipChange.ts` `changeMembership`（DELETE /join、ロール変更→participant） |
| staff による除外・ロール変更・状態変更（confirmed → waitlist/applied/lost 等） | `eventMembers.ts` `setStatus` / `setRole` / `remove` / `cancel`、抽選 `eventSlots.ts` |
| 閲覧権の取消・閲覧をやめる（private） | `eventAccessExit.ts` `revokeEventAccess` |
| 締め出し (#283) | `adminModeration.ts` → `eventChatRepo.blockAuthor` |
| 退会申請（soft delete） | `accountDeletion.ts` `requestDeletion` |
| 退会 purge | `accountDeletion.ts` `deleteAccount`（signer 行は CASCADE で消える） |
| アカウント統合 | 資格は勝ち側へ移る。signer は既存の `uniqueKeyed`（PK に audience を含む）で処理済み。ローテーション不要 |

スタッフ資格（4経路）と違い、参加者資格を失う経路は**多い**（staff の状態変更・抽選・閲覧権取消・
締め出し……）。すべてにフックを置くと漏れたときに「抜けた人が新しい発言を読める」穴が残り、
しかも今後の経路追加のたびに同じ穴が開く。

### 3.2 決定: 取得時の遅延ローテーション（＋送信直前の取り直し）

`groupChatRepo.reconcileMembers(eventId)` を GET/POST `/encrypted-chat` の先頭で呼ぶ:

1. members 部屋の **現役 signer（`revoked_at IS NULL`）のうち、持ち主が 2.4 の 2〜4 を満たさない人**を
   SELECT 1本で列挙（ゲートと同じ述語を SQL に持つ。述語は1か所に定義して GET のゲート判定と共用）
2. 1人以上いれば、D1 batch で (a) その全員の signer に `revoked_at = now`、
   (b) 鍵を**1世代だけ**進める（何人抜けても1世代。`reason='rotated'`）
3. 0人なら何もしない（SELECT 1本のコスト）

この形で安全になる理由（不変条件）:

- **暗号化するのはクライアントだけで、暗号化には最新の鍵が要る。最新の鍵は reconcile を通った
  レスポンスからしか手に入らない。** そこで web は**送信の直前に必ず GET を1回叩き**
  （`fetchQuery`、キャッシュを使わない）、そのレスポンスの最新 version で封をする。
  抜けた人が居れば、この GET の中で新しい世代が作られ、抜けた人には配られない
- 5秒ごとのポーリングも同じ GET なので、誰かが部屋を開いている限り数秒で収束する
- 誰も開いていなければ誰も書かないので、ローテーションが遅れても読まれる新しい発言が無い

即時ローテーションも残す経路（多重防御）:

- **退会申請・purge**: purge で signer 行が CASCADE で消えると、遅延照合の対象（現役 signer）から
  外れてしまい二度と回らない。そこで既存の `onStaffLostEverywhere` を
  `onMemberLostEverywhere(userId)` と並べ、「本人が現役 signer を持つ members 部屋」をすべて
  失効＋1世代進める。呼び出しは既存と同じ2箇所（`requestDeletion` の先頭、`deleteAccount` の (0)）。
  消費サブリクエスト数は既存と同様に purge 予算へ積む

再有効化: 資格を取り戻した人（再参加・締め出し解除・復帰）は POST で signer の `revoked_at` を消し、
全世代を受け取る（不在期間の発言も読める。staff-chat.md 7.3 と同じ割り切り）。

### 3.3 締め出し (#283) の扱い

- 締め出しは**人単位**のまま。`event_chat_blocked` は pubkey を持つので、暗号化部屋の signer の
  pubkey でも締め出せる（運営のモデレーション画面で暗号化メッセージの発言者を選ぶ場合）
- 「その人が締め出し中か」は、平文の `eventChatRepo.isUserBlocked`（`event_chat_key` 経由）と
  `groupChatRepo.isMembersSignerBlocked`（members signer の pubkey 経由）の**どちらか**で判定。
  平文側の既存ゲート（`notBlocked`）にも後者を足す（暗号化部屋の signer で締め出された人が
  平文の過去ログの経路にだけ残らないように）。SQL は各表のリポジトリに置く（監査テストの境界を守る）
- 締め出された人は 2.4 の 4 でゲート不通過＝次の reconcile で失効＋ローテーション
- 締め出し解除は既存の `unblockAuthor`。members signer の pubkey も解除対象に含める
  （`listBlocked` の「人単位に広げる」SQL に members signer を加える）

### 3.4 人数上限: 設けない

| コスト | 量 |
|---|---|
| ローテーション1回 | D1 batch 1回（UPDATE 1 + INSERT 1）。人数に依存しない（何人抜けても1世代） |
| 鍵の配布 | pull。新しい世代の行は ~90 バイト（JSON）。200世代進んでも ~18KB |
| 照合 | GET ごとに SELECT 1本（現役 signer ≤ 参加者数の行を、event_member の PK で引く） |
| 表示許可リスト | members は signer を持つ人だけ。既存の `chat-members` と同じ規模（全員が5秒ごとに取得）で、既存チャットと比べて増えない |

「大人数だと鍵の作り直しの負担が大きい」（Issue の承知事項）は、各メンバーに個別の鍵を配る方式で
起きる話で、共通鍵の pull 配布ではローテーション自体は O(1)。暗号文も1通1回の暗号化で済む。
増えるのは「payload の keys 配列」と「ローテーションのたびに全員が新しい世代を取りに来る」だけで、
後者はもともとの5秒ポーリングに乗る。そのため上限は設けない。
（オーナーが上限を望む場合の案: `ENCRYPTED_CHAT_MEMBER_LIMIT = 500`（確定メンバー数）を超える
イベントではオンにできない、を1行で足せる。オープンな判断 9.）

---

## 4. 読み取りと表示（決めること 4）

### 4.1 共通: `useEncryptedChatChannel`（web）

`components/chat/useEncryptedChatChannel.ts`（新規）。`useChatChannel` と同じ戻り値の形
（`messages / relayConnected / send`）にして、表示側（`ChatMessageList` など）は変えない。

- 入力: `EncryptedChatPayload`（`useEncryptedChat(eventId)` が5秒ポーリング）
- 接続: `ChatRelayPool` を `myKey` の一時鍵（読み取り専用の画面は `randomLocalSigner()`）で開く
- 購読: `pool.subscribe(roomId, cb, GROUP_CHAT_KIND)`。受信時に `openGroupChatMessage` で復号し、
  `content` を平文に置き換えたイベントとしてバッファへ入れる（開けないものは捨てる）
- 送信: 送信直前に payload を取り直し（3.2）、`sealGroupChatMessage` → `myKey` で署名 → publish
- 表示の絞り込み: `members`（revokedAt 以降の発言は `visibleAfterRevocation` で落とす）・
  `hiddenNoteIds`・`CHAT_MESSAGE_MAX` を既存の `selectVisibleChatMessages` に渡す
- 発言鍵は**サーバー管理の一時鍵だけ**（NIP-07 の本鍵は選ばせない。staff-chat.md 3.1 と同じ理由:
  本鍵で書くと「この人がこの非公開イベントで発言した時刻」が Nostr 圏に紐付く）。
  したがって参加 UI（`ChatJoinPanel` の鍵の選択）は暗号化モードでは出さず、初回は POST で発行する

### 4.2 EventChat

`EventChat.tsx` の配線で `event.chatEncrypted` を見て経路を選ぶ（EventChat 本体に暗号処理は書かない）:

- 暗号化オフ: 従来どおり（変更なし）
- 暗号化オン:
  - 新しい発言: `useEncryptedChatChannel`
  - **平文の過去ログ（公開イベントのみ）**: `plaintextChannelId` があれば、既存 `useChatChannel` を
    読み取り専用（`signer=null`、`activeSigner=randomLocalSigner()`、`canOpenChannel=false`）で
    同じ部屋に繋ぎ、`created_at * 1000 <= encryptedAt` の kind 42 だけを表示する。
    名前解決は既存の `chat-members`（公開イベントなので従来どおり取れる）
  - 2つのバッファは `created_at` で合わせて1つの一覧にする
  - 非公開・限定公開イベントでは平文の経路を**一切開かない**（`plaintextChannelId` は常に null。5.）
- 書き込める期間の判定は平文と同じ共有関数 `chatWriteWindow`（#578。既定は開始30分前〜終了2時間後、主催者が選べる）。`encrypted-chat` のペイロードも `writeWindow` を返す
- 非表示 (#278) ボタン: 既存の `POST /chat-hidden`。note id は平文・暗号文で共通

### 4.3 ビンゴ併設 (#499)

`BingoWithChat` は `useEventChatAccess` と `EventChat` をそのまま使うので、4.2 と 5.2 の変更で
自動的に暗号化モードになる。ビンゴ側の変更は無い。投影用 `/bingo/screen` はチャットを持たない（変更なし）。

### 4.4 配信画面 (#562) と OBS、投影用チャット画面 (#215)

- 配信画面 `/events/:id/live/screen` は**スタッフがログインしたブラウザ**で開き、OBS はそのウィンドウを
  キャプチャする（ブラウザソースではない）。したがって画面はスタッフ本人のセッションで
  `GET /encrypted-chat` を叩き、スタッフ本人の資格で鍵一式を受け取ってよい（Issue の合意どおり）
- `useLiveEventChat` は `chatEncrypted` のとき `useChatMembers` の代わりに `useEncryptedChat` を使い、
  `randomLocalSigner()` で roomId を購読して復号する。`liveChatRows` は「平文の本文」を受け取るように
  入力を `{ id, pubkey, created_at, text }` に寄せる（復号は呼び出し側）。鮮度（6秒）・
  `liveChatAuthorized` の判定は同じ式に `chatEncrypted` の分岐を足すだけ
- サーバー側 `liveControl.ts` の `chatSource: "event"` の入口条件
  `event.visibility !== "public"` を `!(visibility === "public" || chatEncrypted)` に変え、
  締め出し判定は 3.3 の人単位判定に揃える
- 投影用チャット `/events/:id/chat/screen`（`EventChatScreenPage`）は `EventChat variant="display"` を
  使うので 4.2 で対応済み（読み取り専用。送信しない）
- 画面にスタッフの鍵が入ることになるが、スタッフ本人の画面なので新しい露出ではない。
  スタッフ資格を失えば次のポーリングで 403 → 画面のチャットは消える（既存と同じ）

### 4.5 運営のモデレーション画面 (#278 / #283)

`AdminModerationPage` は平文チャットをリレーから直接読んで非表示・締め出しを操作する。appAdmin は
2.4 のゲートを通らないので、そのままでは暗号文を読めない。

- `GET /admin/moderation/events/:eventId`（requireAdmin）の payload に
  `encryptedChat: { roomId, keys, members } | null` を足す（部屋が無ければ null）
- 運営は**ローテーションの対象外の受け手**になる。これは新しい露出ではない: サーバー（＝運営）は
  鍵を D1 に平文で持っており、対サーバー E2E ではない（staff-chat.md 5.1 と同じ信頼モデル）。
  UI 文言でも「運営サービスには内容が見える」と書いてある
- 画面は 4.1 の復号関数で暗号文を表示し、非表示・締め出しの操作は既存 API のまま（3.3）

---

## 5. 非公開・限定公開の方針変更（決めること 5）

### 5.1 サーバーのゲート

| 場所 | いま | 変更後 |
|---|---|---|
| `routes/eventChat.ts` 先頭のミドルウェア（平文の全経路） | `visibility !== "public"` → 403 | **そのまま**（平文の経路は非公開では常に閉じる） |
| 同上、暗号化オンの公開イベント | 制限なし | **書き込み系を閉じる**: `POST /chat-key`・`POST /chat-key/ephemeral`・`POST /chat-channel(/create)`・`DELETE /chat-channel` → 409 `chat_encrypted`。`GET /chat-members`・`GET /chat-key/ephemeral`（過去ログの読み取りと名前解決）と非表示操作は残す |
| `/chat-hidden`（POST/DELETE）の非公開イベント | 403 | 暗号化オンなら**許可**（暗号化メッセージの非表示に要る）。ミドルウェアの例外として `chatEncrypted` を見る |
| `routes/encryptedChat.ts`（新規） | - | 2.4 のゲート。公開範囲は問わない（暗号化オンが前提） |
| `liveControl.ts` chatSource | `visibility !== "public"` → 403 | 4.4 |
| `events.ts` 正規化 | `visibility === "public" && chatEnabled` | `(visibility === "public" \|\| chatEncrypted) && chatEnabled`（1.2） |

### 5.2 web のゲート

- `useEventChatAccess.chatAvailable` の `event.visibility === "public"` を
  `(event.visibility === "public" || event.chatEncrypted)` に
- `EventChat.tsx` の `chatUnavailable` の `event.visibility !== "public"` も同じ式に
- `EditEventPage` の `chatEnabled: visibility === "public" && chatEnabled` を同じ式に
- `eventAccessLifecycle.ts`（非公開で詳細取得に失敗したらキャッシュを捨てる）は変更なし。
  キャッシュ破棄対象に `encryptedChat` キーを足し、失効時に鍵を画面から消す

### 5.3 文言（`packages/shared/src/i18n/messages/eventAccess.ts`）

- `chatPrivacy`（ja）:
  「非公開・限定公開イベントでは、『参加者のみ（暗号化）』をオンにした参加者チャットだけを使えます。
  暗号化した発言は参加者とスタッフだけが読めます（運営サービスには内容が見えます）。
  参加を取り消した人も、それまでに読めた発言は手元に残ります。以前に公開で送った発言やそのコピーは回収できません。」
- `chatPrivacy`（en）: 同じ内容の英訳
- `visibilityWarning` の「非公開・限定公開では参加者チャットが停止します」→
  「暗号化していない参加者チャットは停止します」（ja/en）
- `docs/private-events.md` §1.1・§5.1・表の「参加者チャット API と外部WS」行を本書参照に同期する
  （「#205 の暗号化は別承認まで実装しない」→「#582 で実装。本書参照」）

---

## 6. マイグレーションと登録（決めること 6）

### 6.1 `apps/server/migrations/0101_participant_encrypted_chat.sql`

main の最新は `0100_presenter_slides.sql` なので 0101。

1. `event` に `chat_encrypted` / `chat_encrypted_at`（1.1）
2. `event_group_chat_room` の CHECK を `audience IN ('staff','members')` に広げる。SQLite は CHECK を
   変更できないので**3表を作り直す**。`event_group_chat_room` を DROP すると、外部キーが有効な環境では
   暗黙の DELETE が子表へ CASCADE し、**スタッフチャットの鍵が消える**。これを避けるため順序を固定する:
   1. 3表の中身を一時表へコピー（`CREATE TABLE tmp_x AS SELECT * FROM x`）
   2. **子から**DROP（signer → key → room。子が先に消えているので CASCADE は空振り）
   3. 0075 と同じ定義（CHECK だけ変更）で3表とインデックスを作り直す
   4. 一時表から INSERT（room → key → signer）、一時表を DROP
   - 行数・`(event_id, audience, version)` の全件一致を検証するテストを置く（9. テスト計画 S1）。
     ローカル D1（`wrangler d1 migrations apply --local`）で既存のスタッフ部屋入りの DB に対して流し、
     staff の GET が同じ roomId・同じ鍵を返すことを実装時に確認する

### 6.2 user-tables / 退会 / 統合

- **新しく user を参照する表は無い**。`event_group_chat_signer.user_id`（CASCADE）は既存。
  `userTables.ts` の各定義と `user-tables.test.ts` / `merge-user-columns.test.ts` の実数固定は**変わらない**
  （作り直しで列定義が変わらないことをこの2テストが確認する）
- 統合: `accountMerge.ts` の `["event_group_chat_signer", "user_id", ["event_id", "audience"]]` が
  members にもそのまま効く（同じ部屋に両方が signer を持てば負け側を捨てる）。コメントだけ更新
- 退会: 3.2 の `onMemberLostEverywhere` を `requestDeletion` / `deleteAccount` に追加
  （`onStaffLostEverywhere` と同じ位置・同じ順序、purge 予算へのコスト加算も同じ）
- イベント削除: 3表は FK CASCADE で消える。リレー上の暗号文は誰にも復号できなくなる（staff と同じ）

---

## 7. UX と文言（決めること 7）

UI に Nostr・NIP-44 等の技術名は出さない（参加者向け文言の方針）。

### 7.1 管理（イベント編集 `EditEventPage`）

チャットのスイッチの下（`chatUrlsAllowed` と同じ字下げ）に:

- スイッチ「参加者のみ（暗号化）」
- 説明: 「オンにすると、これからの発言は参加確定者とスタッフだけが読めるようになります。
  これまでの発言は今のまま残ります。一度オンにすると戻せません。」
- オンへの切り替え時に確認ダイアログ（同文＋「オンにしますか？」）
- オン済みならスイッチは無効表示（チェック済み）で「この設定は戻せません」
- 非公開・限定公開イベントでは: チャットのスイッチをオンにすると「参加者のみ（暗号化）」も
  同時にオンになり変更不可。説明「非公開・限定公開イベントのチャットは常に参加者のみ（暗号化）です」

### 7.2 チャット画面の表示

- 見出しの横にチップ「参加者のみ・暗号化」（鍵アイコン）。ツールチップ／小さな説明:
  「このチャットは参加確定者とスタッフだけが読めます。内容は暗号化されて外部サーバーに保存されます
  （運営サービスには内容が見えます）。」
- 公開イベントで暗号化をオンにした境目に、一覧の区切り「ここから参加者のみ」を1行出す
  （平文の過去ログがあるときだけ）
- 投影用 (`variant="display"`) と配信画面ではチップ・区切りを出さない（見せる画面なので）

### 7.3 鍵を持たない人に見えるもの

| 人 | 表示 |
|---|---|
| 未ログイン・未参加・参加待ち（waitlist/applied/lost） | 既存と同じ（`chatAvailable=false` のため参加者チャット欄は出ない／参加の案内） |
| 参加を取り消した人・締め出された人 | 既存の `eventSocial.chatUnavailable`（理由は書かない #283） |
| ローテーション直後で新しい世代をまだ持っていない人 | 次のポーリングで取得して自動で表示。それまで該当の発言は出さない（エラー表示はしない） |
| 外部の Nostr クライアント | 暗号文（kind 9807）なので読めない。アプリ側の対応は無い（Issue の承知事項） |

---

## 8. 範囲外（決めること 8）

- **#578 開催前から書き込める設定**（書き込み時間帯の変更）。別 Issue・別設計
- **過去の平文メッセージの遡及的な暗号化・削除**（署名済みイベントは書き換えられず、リレー上の
  コピーも回収できない）
- 暗号化オフへの切り替え（1.2）
- 新着通知・メール（staff-chat.md 10 と同じ理由）
- NIP-07 本鍵での暗号化発言（4.1）
- 部屋の作り直し（`DELETE /chat-channel` 相当）。kind 40 を使わないので不要（staff と同じ）
- サーバー側での受信時刻による失効判定（バックデート注入の限界は staff-chat.md 7.3 と同じ割り切り）
- 人数上限（3.4。オーナーが望めば後から1行）

---

## 9. テスト計画（決めること 9）

### server

- S1 マイグレーション: 0101 適用前にスタッフ部屋（room/key 2世代/signer）がある DB で、適用後も
  3表の行が全件一致し、`audience='members'` が INSERT できる。`audience='other'` は CHECK で落ちる
- S2 スタッフチャットの回帰: 既存の `staff-chat.test.ts`・`staff-chat-sql-audit.test.ts`（対象ファイル名のみ変更）が
  期待値無修正で緑。members 部屋を作っても `/staff-chat` の payload に members の鍵・signer が出ない
  （逆も: `/encrypted-chat` に staff 部屋の roomId・鍵が出ない）
- S3 ゲート: confirmed の participant/staff/judge/observer は 200。waitlist/applied/lost/canceled・非メンバー・
  appAdmin・コミュニティ管理者・締め出し中（平文鍵／members signer の両方）・退会申請中 → 403 `chat_unavailable`。
  暗号化オフ・`chatEnabled=false`・未公開・日程調整中 → 403
- S4 設定の規則: オフ→オン可（`chat_encrypted_at` が入る）、オン→オフ 409、非公開で `chatEnabled=true` かつ
  暗号化オフは 400、公開→非公開で暗号化オンなら `chatEnabled` 維持・オフなら false
- S5 遅延ローテーション: 3.1 の各経路（本人取消・staff による状態変更・ロール変更・抽選で lost・閲覧権取消・
  締め出し・退会申請）のあとに別メンバーが GET → keys の version が1つ増え、対象の signer に revoked_at、
  対象者の GET は 403。2人同時に抜けても1世代だけ進む。誰も抜けていなければ GET で世代が増えない
- S6 即時ローテーション: 退会申請・purge で、本人が現役 signer を持つ全 members 部屋が1世代進む。
  purge の戻り値（サブリクエスト数）が増える
- S7 再有効化: 再参加・締め出し解除のあと POST で revoked_at が消え、全世代を受け取る
- S8 平文経路: 暗号化オンの公開イベントで `POST /chat-key`・`/chat-key/ephemeral`・`/chat-channel/create` が
  409 `chat_encrypted`、`GET /chat-members` は 200。非公開イベントでは平文の全経路が 403 のまま、
  ただし暗号化オンなら `/chat-hidden` は通る
- S9 配信: `PATCH /live-state {chatSource:"event"}` が非公開＋暗号化オンで通り、暗号化オフでは 403
- S10 モデレーション: appAdmin の payload に `encryptedChat` が載り、非 admin には載らない。
  members signer の pubkey での締め出し・解除が人単位で効く
- S11 統合: 両アカウントが同じ members 部屋に signer を持つとき勝ち側だけが残る。
  `user-tables.test.ts` / `merge-user-columns.test.ts` の実数は不変

### web

- W1 `groupChatCrypto.test.ts`（改名のみ。既存の往復・version 引き・失効後の描画除外）
- W2 `useEncryptedChatChannel`: 受信した暗号文を復号して一覧に出す／開けないものは出さない／
  送信前に payload を取り直し、最新 version で封をする（取り直しで世代が増えた場合も新しい世代を使う）
- W3 `EventChat`: 暗号化オンの公開イベントで平文の過去ログ（`encryptedAt` 以前のみ）と暗号文が1つの一覧に並ぶ。
  非公開イベントでは平文の購読を開かない。チップ「参加者のみ・暗号化」が出る（display では出ない）
- W4 `useEventChatAccess`: 非公開＋暗号化オンで `chatAvailable=true`、非公開＋オフで false
- W5 `useLiveEventChat`: 暗号化オンで `useEncryptedChat` の鍵で復号した本文が行になる。鮮度切れ・403 で消える
- W6 `EditEventPage`: オンへの切り替えで確認、オン済みはスイッチ無効、非公開ではチャットオンと連動
- W7 `BingoWithChat`: 既存テストが緑（暗号化オンでも EventChat 経由で動く）

### 実機（staging）

- 公開イベントで平文で数件 → 暗号化オン → 暗号文で数件。両方が並び、外部クライアントからは
  オン後の発言が読めない（kind 9807 の暗号文）
- 非公開イベントで暗号化チャット・ビンゴ併設・配信画面（OBS キャプチャ）で表示
- 参加者を除外 → その人の画面が 403、残りのメンバーの次の発言が新しい世代で送られる

---

## 10. 実装の単位（参考）

1 PR を想定（スタッフチャットの改名と members の追加を分けると、改名だけの中間状態で
SQL 監査の対象ファイル名がずれる期間ができるため）。順序:
(1) 0101・リポジトリ改名と audience 引数化・staff 回帰テスト →
(2) 設定列と正規化・`encrypted-chat` ルート・遅延ローテーション・退会フック →
(3) 平文経路の制限・live/モデレーション →
(4) web（フック・EventChat・配信・設定 UI・文言）→
(5) docs 同期（staff-chat.md の「#205 が乗る」記述、private-events.md）
