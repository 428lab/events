# イベントスタッフ用のチャットルーム（公開前から使える） (#382)

- 対象: `apps/server`（D1 スキーマ・鍵配布 API・ローテーション）、
  `packages/shared`（kind・型・入力スキーマ）、`apps/web`（暗号化チャット画面）
- 前提: #339（スタッフ招待）は**マージ済み**。#205（参加者向け非公開チャット）は**未着手**。
  本設計は #205 の方式をスタッフ範囲で先に実装するもので、#205 が後から同じ土台に乗る
- ステータス: **実装済み**（PR #406）。実装で設計から変えた点は 13. にまとめた

---

## 1. なぜ作るか

いまのイベントチャット (#199) は参加者向けで、`event.status === "published"` かつ
`chatEnabled` でないと使えない（`useEventChatAccess.ts` の `chatAvailable`）。
スタッフは**イベントを作った直後、まだ誰にも見えない状態**から相談を始めたいが、
その場所が無い。

要件は3つ (#382)。

1. **公開前から使える。** これが一番の要件
2. スタッフ（と招待を承諾した運営 #339）だけが読み書きできる
3. 参加者からは**存在ごと**見えない

---

## 2. 調査結果

### 2.1 既存チャットの構造（#199。土台としてそのまま使える部分が多い）

| 部品 | 場所 | 中身 |
|---|---|---|
| リレー接続 | `apps/web/src/lib/nostrChat.ts` (431行) | `ChatRelayPool`（再接続・NIP-42 AUTH・購読・発行）。購読フィルタは `kinds:[42], "#e":[channelId]` で **kind がハードコード** |
| サーバー側 | `apps/server/src/routes/eventChat.ts` (392行) | 鍵の紐付け・チャンネルID・非表示リストのみ。**本文は一切通らない** |
| 鍵の保管 | `event_chat_key` 表（0066） | その人がイベントで使った鍵ぜんぶ＋サーバー管理一時鍵の secret (#223/#332) |
| 表示の絞り込み | `chat-members` API | 許可リストに載った pubkey の発言だけ描画（野良投稿はアプリに出ない） |
| 画面 | `EventChat.tsx` (**959行**, #360) | 800行制約を既に超過。**ここには足さない** |

重要な性質: **本文はブラウザ⇔リレー直通**で、サーバーはメッセージを見ない。
封じ込めは「書き込みは自リレー2台限定（`wss://r.kojira.io` / `wss://x.kojira.io`）＋
NIP-42 AUTH」に加え、NIP-70 を適用（#460。`docs/nip70-protected-chat.md` 参照）。
対応リレーが第三者による持ち込み（他リレーで拾ったコピーの再 EVENT）を拒否する。

### 2.2 #205 の既定方針（揃える先）

- 独自 kind（一般クライアントに表示されない）
- 本文は**監査済みの NIP-44 実装**（nostr-tools）で暗号化。暗号プリミティブは自作しない
- **イベントごとのグループ共通鍵をサーバーが生成し、認証 API で配布**（鍵配布のみ独自）
- 退会・除名時は**鍵ローテーション＋再配布**。過去ログは元メンバーに可読（一般的チャット同等の割り切り）
- リレーは**素の strfry のまま**（relay29 等の追加対応は不要）
- **サーバーは鍵を知る＝対サーバー E2E ではない**（既存の信頼モデルと同等）

### 2.3 nostr-tools に NIP-44 があるか（確認済み）

`apps/web` の nostr-tools は **2.24.1**（lockfile とインストール実体の両方で確認）。
`nostr-tools/nip44` が存在し、`v2.encrypt(plaintext, key)` / `v2.decrypt(payload, key)` /
`getConversationKey()` をエクスポートする。`key` は 32 バイトの conversation key で、
ECDH 由来である必要はなく**一様乱数の共有鍵をそのまま渡せる**（NIP-44 v2 の要件は
「32バイトの一様な鍵」であり、乱数はこれを満たす）。**新しい依存は増えない**。
サーバー側は鍵を生成・保管・配布するだけで暗号化はしないので、nostr-tools 自体不要
（乱数は `crypto.getRandomValues`）。

### 2.4 スタッフの判定（既にある。増やさない）

`apps/server/src/auth/roles.ts` の 3 つの使い分けは staff-todo.md 2.2 と同じ。
本機能の読み書きは **`isConfirmedEventStaff`**（そのイベントの `status='confirmed'` な
staff だけ。appAdmin・コミュニティ管理者は**通らない**）に合わせる。理由:

- 「イベント配下の表示・操作は myRole だけで判定する」という方針（#275）。
  必要な人はそのイベントの staff に加わればよい
- 判定を event_member 1 表に閉じると、**スタッフ資格を失う経路が
  event_member の変更 3 経路に限定され、鍵ローテーションの仕掛け所が漏れなく列挙できる**
  （`canManageEvent` を使うと「コミュニティ管理者から外れた」という第4の経路が
  コミュニティ側に生まれ、そちらのロール変更にもフックが要る）

イベント作成者は作成時に staff / confirmed の行ができる（`routes/events.ts` の
`eventMembersRepo.add(event.id, user.id, "staff")`。既定 status は confirmed）ので、
**作成直後から条件を満たす**。

### 2.5 #339 の状態遷移と「公開前から鍵を配れるか」

招待は `event_staff_invite` 表（pending / accepted / declined / revoked）で、
**メンバー行ができるのは accepted の瞬間だけ**。declined / revoked / pending は
権限ゼロのまま。承諾時には「招待した人がいまも運営か」を承諾時点で再確認する。

#205 の鍵配布は「確定メンバーだけに認証 API で配布」だが、これは
**「配布時点でゲート関数を通る人に配る」という仕組み**であって、参加確定という
集合そのものに依存しない。ゲートを `isConfirmedEventStaff` に差し替えれば
**同じ仕組みのまま集合だけが変わる**。公開前でもイベント作成者は staff/confirmed
なので、公開状態は条件に入らない。→ **「公開前から使える」と #205 の鍵配布は両立する**（4. で詳述）。

### 2.6 スタッフ資格を失う経路（ローテーションの仕掛け所）

| 経路 | 場所 | いまの動き |
|---|---|---|
| 降格（staff→他ロール） | `routes/events.ts` PATCH `/:id/members/:userId/role` | `setRole` または `leaveEvent`。**最後の staff は降ろせない**（`last_staff` 409）ので staff は常に1人以上残る |
| 本人の参加解除 | `routes/events.ts` DELETE `/:id/join` → `leaveEvent` | メンバー行を削除 |
| 退会申請（soft delete） | `users.ts` `requestDeletion`（#250） | メンバー行は残るがセッション全削除で API を叩けなくなる。**申請前に受け取った鍵は手元に生きている**ので、purge（31日後）まで回さないと猶予期間中の新規発言を外部クライアントで読み続けられる（レビュー指摘）。ここにもフックが要る |
| 退会（完全削除） | `users.ts` `deleteAccount`（purge #250） | event_member は FK CASCADE で消える。**ルートを通らない**のでここにもフックが要る（申請時に回っていれば多重防御として1世代余分に進むだけ） |

アカウント統合は「負け側が staff なら勝ち側を staff に引き上げる」（`users.ts` (0)）ので
資格は失われず、ローテーション不要。

---

## 3. 方式の決定

### 3.1 決定: #205 の方式をスタッフ範囲で先行実装する

**独自 kind ＋ NIP-44 v2（nostr-tools の監査済み実装）＋ サーバーによるグループ共通鍵の
生成・配布・ローテーション。リレーは素の strfry のまま、既存の2台をそのまま使う。**

これに、スタッフチャット固有の判断を2つ足す。

1. **部屋は Nostr 上に「作らない」。** NIP-28 の kind:40（チャンネル作成。イベント題名が
   平文で載る）は発行せず、サーバーが乱数 64hex の roomId を採番して staff にだけ配る。
   メッセージはこの roomId を `e` タグに載せた独自 kind として発行する。
   リレー上には「どのイベントの部屋か」を示す情報が一切出ない
2. **発言は専用のサーバー管理一時鍵のみ**（NIP-07 本鍵の選択肢を出さない）。
   本鍵で書くと「この人がこの時刻に運営の相談をしていた」が全 Nostr 圏に紐付く。
   参加者チャットの一時鍵 (`event_chat_key`) を**使い回さない**理由は 6.2

### 3.2 捨てた案

| 案 | なぜ捨てたか |
|---|---|
| **NIP-29（グループ）** | リレー側の実装（relay29 等）が必須。#205 のコメントで「素の strfry で動くこと・relay29 不要」が制約として明記されており、**リレーに手を入れない前提に反する**。メンバー管理をリレーに持たせても、サーバー側の staff 判定と二重管理になる |
| **NIP-28 を非公開運用（平文）** | リレーは公開なので、チャンネルIDさえ分かれば誰でも全文を読める。要件2に反する |
| **独自暗号** | 論外。暗号プリミティブの自作は #199 の時点から一貫して禁止（issue にも「独自暗号は不可」と明記）。使うのは監査済みの NIP-44 実装のみ |
| **D1 にメッセージを保存する自前チャット** | メタデータもリレーに出ない点では最強だが、(a) チャット基盤が Nostr 系と D1 系の**2系統**になり、鍵配布・表示・接続の仕組みを二重に持つ、(b) リアルタイム性はポーリング頼みで、#205（参加者規模）が後から乗れない、(c) 「方式は #205 と揃えたい」という issue の判断に反する。**メタデータ露出は 5. の緩和策で許容範囲に収まる**と判断した |
| **#205 を先に全部作ってからスタッフに適用** | 参加者向け非公開チャットはスコープが大きい（公開/非公開の切替 UI・既存チャットとの排他など）。スタッフチャットは集合が小さく閉じており、**土台（鍵配布・ローテーション）を先に小さく作って #205 がそれに乗る**方が順序として安全 |

### 3.3 独自 kind と部屋の識別

- kind は共有定数 `GROUP_CHAT_KIND = 9807`（`packages/shared/src/staffChat.ts`）。
  regular（1000–9999 = リレーが保存する）範囲で、既知の NIP・慣用 kind
  （9000–9030: NIP-29、9041/9734/9735: zap、9321: NIP-61、9802: highlight）と
  重ならない値を選んだ。万一将来衝突しても本文は暗号文なので実害は他クライアントでの
  見え方だけだが、**最初の部屋を本番に作る前なら定数1つで変えられる**
- 部屋の識別は `["e", roomId, relayHint, "root"]` タグ。roomId はサーバー採番の乱数
  64hex。`e` タグを使うのは、strfry が単一文字タグに索引を張るため
  `{"kinds":[9807],"#e":[roomId]}` のフィルタがそのまま効き、既存 `ChatRelayPool` の
  購読形と一致するため（変更は kind の引数化だけで済む）
- 鍵バージョンは `["v", "<n>"]` タグに平文で載せる（どの世代の鍵で復号するかは
  復号前に分かる必要がある。バージョン番号自体は秘密ではない）
- content は `nip44.v2.encrypt(本文, 鍵)` の結果。本文の上限は既存の
  `CHAT_MESSAGE_MAX`（500字）を共用

---

## 4. 「公開前から使える」×「#205 の鍵配布」の両立（決めること2）

#205 の配布は push ではなく **pull**（本人が認証 API を叩いたときにゲートを通れば返す）
として設計する。すると:

- **鍵を配る対象の集合＝ゲート関数**。参加者チャットなら「参加確定メンバー」、
  スタッフチャットなら `isConfirmedEventStaff`。**仕組みは同一で、差はゲート1つ**
- 公開前かどうかはゲートに現れない。作成者は作成直後から staff/confirmed（2.4）
- 招待の承諾 (#339) で「鍵を配る」処理は**不要**。承諾でメンバー行ができれば、
  本人が次に部屋を開いたときにゲートを通って鍵一式を受け取る。
  承諾フローに配布処理を差し込まないので、#339 側のコードには触らない
- declined / revoked / pending は最初からゲートを通らない。**配ったものを回収する場面が
  「一度 accepted になってから資格を失った」の1通りに絞られ**、それが 6. のローテーション

既存の参加者チャットが「公開後のみ」なのは、ゲートではなく
`chatAvailable`（web）と `/chat-channel/official` の published 検査（server）による。
スタッフチャットはこれらを課さないだけで、鍵配布の仕組み側に作り直しは無い。

---

## 5. 信頼モデルとメタデータ露出

### 5.1 サーバーは鍵を知る（明記）

グループ共通鍵と発言用一時鍵の secret は D1 に平文で保管し、サーバー（＝アプリ運営）は
その気になれば全文を復号できる。**対サーバー E2E ではない。** これは
- 参加者チャットの一時鍵 (#223) をサーバーが保管している既存の信頼モデルと同等
- #205 が明示している割り切り（「サーバーは鍵を知る＝対サーバー E2E ではない」）
と一致する。守っている相手は「リレーを覗ける第三者と、鍵を持たない参加者」であって、
アプリ運営ではない。UI にもその旨を書く（技術用語は出さず「運営サービスには内容が
見える」程度の文言。UI文言方針に従う）。

### 5.2 公開リレーに出るもの・出ないもの

暗号化しても、公開リレー（`wss://r.kojira.io` / `wss://x.kojira.io`）には
イベントの外形＝メタデータが残る。

| リレー上で第三者に見えるもの | 緩和策と残余リスク |
|---|---|
| kind 9807 の暗号文が存在すること・投稿時刻・おおよそのサイズ | NIP-44 v2 はパディング付きで正確な長さは丸まる。「どこかの運営が何時に何通話したか」までは露出する。**許容する**。NIP-70 の `["-"]`（#460）により対応リレーへの再放流は拒否される（コピーの再配布先を仕様が拒む） |
| 投稿者 pubkey | **専用一時鍵のみ**なので、実在の人物・本鍵と紐付かない乱数。表示許可リスト（pubkey→氏名）は staff 限定 API の中にしか無い |
| roomId（e タグ） | サーバー採番の乱数で、イベントとの対応表はサーバー内にしか無い。**どのイベントの部屋かは外から分からない**。kind:40 を発行しないのでイベント題名も出ない |
| 同じ roomId への投稿の集まり | 「同一の部屋で N 人ぶんの pubkey が活動している」ことは分かる。人数規模と活動時間帯は隠せない。**許容する** |

許容の根拠: 隠したいのは「相談の中身」と「誰が・どのイベントか」であり、どちらも守れる。
「いつ・何通・何人規模」まで隠すには自前ストレージ（3.2 で捨てた案）しかなく、
そのコストに見合わない。

なお roomId は第三者もリレー上の暗号文から**読める**（購読フィルタに使う値なので当然）。
roomId の秘匿性は「イベントとの対応を隠す」ためのもので、アクセス制御は暗号鍵が担う。
外部の人が同じ roomId に野良投稿しても、(a) 表示許可リストに無い pubkey は描画されず、
(b) 復号にも失敗するので、アプリの画面には出ない（既存チャットの許可リスト方式と同じ）。
受信バッファ（500件）が野良投稿で埋まって本物の履歴が押し出されないよう、
あふれたときは**許可リスト外の投稿から先に捨てる**（`staffChatBuffer.ts`。
あふれるまでは捨てない：参加したての staff の発言が許可リストに載る前の
数秒間に届いても失わないため）。

---

## 6. スキーマとマイグレーション（0075_staff_chat.sql）

#205 が後から乗れるよう、表の名前と主キーに **audience 列**（部屋の対象範囲）を最初から
含める。いまは `'staff'` のみ。#205 は CHECK に `'members'` を足して同じ表に乗る
（鍵配布・ローテーションのコードもゲート関数の差し替えで共用できる）。
表を staff 専用に切ってしまうと、#205 の時点で「同じ契約が2か所」になる。

```sql
-- グループチャットの部屋 (#382)。audience='staff' はスタッフ用ルーム。
-- 参加者向け API はこの表に一切触れない（event の serializer にも載せない）。
-- room_id はサーバー採番の乱数64hex。リレー上の e タグとしてだけ使い、
-- イベントとの対応はこの表の中にしか無い
CREATE TABLE event_group_chat_room (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('staff')),
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, audience)
);

-- グループ共通鍵（NIP-44 の conversation key、乱数32バイトのhex）。
-- ローテーションで version が増える。行は消さない：過去 version を消すと
-- その世代で書かれた履歴が現メンバーにも読めなくなる
CREATE TABLE event_group_chat_key (
  event_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  version INTEGER NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 'created'（部屋の開設） / 'rotated'（資格喪失によるローテーション）。監査用
  reason TEXT NOT NULL CHECK (reason IN ('created', 'rotated')),
  PRIMARY KEY (event_id, audience, version),
  FOREIGN KEY (event_id, audience)
    REFERENCES event_group_chat_room(event_id, audience) ON DELETE CASCADE
);

-- メンバーごとの発言用一時鍵（サーバー生成・保管 #223 と同方式）。
-- 参加者チャットの event_chat_key とは分ける（理由は設計ドキュメント 6.2）。
-- 行は消さない（消すとその人の過去の発言が全員の画面から消える）。
-- revoked_at: スタッフ資格を失った時刻。表示側は「revoked_at より後に
-- 作られたメッセージ」を描画しない（資格喪失後の書き込みを画面に出さない）
CREATE TABLE event_group_chat_signer (
  event_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  pubkey TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (event_id, audience, user_id),
  FOREIGN KEY (event_id, audience)
    REFERENCES event_group_chat_room(event_id, audience) ON DELETE CASCADE
);
-- 同じ部屋で同じ pubkey を2人が持てない（乱数衝突の保険。既存 0066 と同じ考え）
CREATE UNIQUE INDEX idx_event_group_chat_signer_pubkey
  ON event_group_chat_signer (event_id, audience, pubkey);
-- mergeUsers の付け替えと退会 purge の列挙で user 起点に引く向き
CREATE INDEX idx_event_group_chat_signer_user
  ON event_group_chat_signer (user_id);
```

設計上の決定:

- **event 表には列を足さない。** `toEvent()` は列を明示的に選んで返しているが、
  部屋の存在を示す値がイベント行に同居していると、serializer の変更1つで参加者向け
  ペイロードに漏れる径路ができる。別表なら**構造として**漏れない（staff-todo.md 3.5 と同じ閉じ方）
- **user_id への FK は CASCADE。** 退会の完全削除でメンバー行と一緒に signer 行も消える。
  ただし消えるだけではローテーションにならないので、purge 側にフックを置く（7.3）
- signer の secret を NULL 可にしない（participant チャットの「本鍵 or 一時鍵」の
  二択が無く、常にサーバー生成鍵のため。列の意味が1つになる）

### 6.2 participant チャットの `event_chat_key` を使い回さない理由

`event_chat_key` の行は `chat-members` API（**全参加者が数秒ごとに取る表示許可リスト**）に
そのまま出る。スタッフチャット用の鍵をそこに足すと、参加者が
「この pubkey はこの staff のもの」という対応を得てしまい、公開リレー上の kind 9807 を
その pubkey で絞れば「staff X が(内容不明の)投稿をした時刻」が個人単位で追える。
5.2 の「投稿者 pubkey は誰とも紐付かない」を守るには、**スタッフチャットの pubkey が
参加者向け API に一度も現れない**ことが必要で、それは表を分けるのが一番確実。
（コードの重複は生成ロジック `generateChatKey()` の再利用で避ける。増えるのは表だけ）

---

## 7. 鍵のライフサイクル

### 7.1 生成（部屋の開設）

- 部屋・v1 鍵・自分の signer は、staff が**最初にチャットを開いたとき**に
  `POST /events/:id/staff-chat` で遅延生成する（使わないイベントに鍵を作らない）
- 生成は**先勝ち・冪等**。room は PK (event_id, audience) の `INSERT OR IGNORE`、
  鍵 version は「現最大+1」を UNIQUE 衝突でリトライ。2人の staff が同時に開いても
  部屋と v1 は1つに定まる（一時鍵 #332 と同じ倒し方）
- スタッフの操作で ON/OFF する設定は**設けない**。参加者チャットの `chatEnabled` は
  「参加者に見せるか」の判断だが、スタッフ部屋は運営自身の道具で、
  開かなければ作られないだけ。設定の口を増やさない

### 7.2 配布

- pull 型（4.）。`GET /events/:id/staff-chat` がゲート（`isConfirmedEventStaff`）を
  通った人に、roomId・**全 version の共通鍵**・自分の signer（pubkey+secret）・
  表示許可リスト・リレーURLをまとめて返す。`Cache-Control: no-store`
- 全 version を返すのは過去ログの復号のため。新規発言は常に最新 version で暗号化
- 招待を承諾した人は、次に開いた時点でゲートを通り自動的に全鍵を受け取る。
  **配布のための追加フローは無い**

### 7.3 ローテーション（資格喪失）

`staffChatRepo.onStaffLost(eventId, userId)` を1つ作り、次を1トランザクション相当
（D1 batch）で行う:

1. その部屋の signer 行に `revoked_at` を打つ（行は消さない。履歴表示のため）
2. **部屋が存在すれば**共通鍵を1世代進める（`reason='rotated'`）。部屋が無ければ何もしない

呼び出し箇所は 2.6 の4経路（漏れると「抜けた人が新しい発言を読める」が残る）:

| 経路 | フックの置き場所 |
|---|---|
| 降格 | `routes/events.ts` のロール変更ハンドラ。`before.role === "staff"` かつ新ロールが staff 以外のとき |
| 参加解除 | `leaveEvent()` 内。`leaving.role === "staff"` のとき（DELETE /join とロール変更→participant の両方がここを通る） |
| 退会申請 | `users.ts` `requestDeletion` 内。「confirmed staff だったイベント」を列挙して各部屋を回す（`onStaffLostEverywhere`）。**申請の時点で回す**：purge まで待つと猶予期間（30日）のあいだ、申請前に配られた鍵で新規発言を読み続けられる。復帰（restore）した人はゲートを再び通って全世代を受け取り直すので両立する |
| 退会 purge | `users.ts` `deleteAccount` 内。申請時と同じ列挙で各部屋を回す（signer 行自体は CASCADE で消える）。申請時に回っていれば1世代余分に進むだけの**多重防御**。消費サブリクエスト数を返し、purge の実行予算（`lib/purgeDeleted.ts`）に実数で積む |

ローテーションの意味と限界（承知のうえ。#205 と同じ割り切り）:

- 抜けた人は**新しい発言を読めなくなる**（新 version を配られないため。リレーは公開なので
  外部クライアントで購読はできるが復号できない）
- 抜けた人は**持っている旧鍵で過去ログを読み続けられる**（配った鍵は回収できない。
  一般的なチャットで「抜けた人の記憶・手元ログは消せない」のと同等）
- 抜けた人が旧鍵＋旧 signer で**書く**ことは技術的には可能だが、
  表示側が `revoked_at` より後のメッセージを描画しないため、アプリの画面には出ない
  （participant チャットの締め出し #283 と同じ「アプリの中で効く」設計）。
  **ただしこの判定は `created_at`（署名者が自由に書ける自己申告の時刻）に
  依存する**（レビュー指摘）。抜けた人が時刻を失効前に偽装して発行すると、
  現役の画面に「在籍中の発言」として表示される（読み取りは新世代鍵で守られて
  おり不可。**書き込みの注入だけ**）。根本対策にはサーバー側の受信時刻が要るが、
  本文がサーバーを通らない構造上 v1 ではやらない。#283 と同型の
  「その場の道具であって恒久的な追放ではない」割り切りとして明記する
- 再招待→再承諾で戻った人は `revoked_at` を消して同じ signer を再有効化し、
  全 version を受け取る（不在期間の履歴も読める。割り切りとして明記）

### 7.4 完全削除

- **イベント削除**: FK CASCADE で room / key / signer が全部消える。リレー上の暗号文は
  残るが、鍵が消えた時点で**誰にも（運営にも）復号できないゴミ**になる。
  これを「削除でチャット履歴も読めなくなる」という仕様として明記する
- **ユーザーの退会 purge**: signer 行は CASCADE、資格喪失として 7.3 のローテーション。
  共通鍵はイベントのものなので残る
- **アカウント統合**: 資格は勝ち側に引き継がれる（2.6）。signer は PK (event, audience,
  user) 衝突時に勝ち側の行を残し、負け側の行は user_id を勝ち側へ付け替え……は PK 衝突
  するため、**負け側に signer 行がある部屋に勝ち側の行も既にあるときだけ負け側を削除、
  それ以外は user_id を付け替え**（`event_chat_key` の統合 (1b) と同じ形）。
  削除された側の pubkey の過去発言は表示から消えるが、同一人物の統合という
  稀なケースの割り切りとする

---

## 8. API

すべて `requireAuth` ＋ `isConfirmedEventStaff` ゲート。ルートは
`apps/server/src/routes/staffChat.ts`（新規。`eventChat.ts` には足さない）、
リポジトリは `apps/server/src/db/repositories/staffChat.ts`（新規）。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/events/:id/staff-chat` | 部屋が有れば payload（下記）を返す。無ければ 404。自分の signer が**未発行・失効中**なら payload の `myKey` を null で返す（クライアントは POST で発行/再有効化） |
| POST | `/api/events/:id/staff-chat` | 部屋・v1 鍵・自分の signer を無ければ作り（先勝ち・冪等）、GET と同じ payload を返す。失効中の signer は再有効化する（7.3）。生成した pubkey が同じ部屋で他人に使用済みのとき 409（乱数256bitなので現実には起きない保険）。発行後の読み直しで `myKey` が取れないときも防御的に 409 |

```ts
// packages/shared/src/staffChat.ts
export const GROUP_CHAT_KIND = 9807;
export interface StaffChatPayload {
  roomId: string;
  /** 全世代。復号は v タグの version で引く。新規発言は最新 version で暗号化 */
  keys: Array<{ version: number; secret: string }>;
  /** 自分の発言用一時鍵（サーバー生成・保管）。未発行なら null（POST で発行） */
  myKey: { pubkey: string; secret: string } | null;
  /** 表示許可リスト。revoked_at 付きの人も返す（過去の発言の名前解決のため） */
  members: Array<{
    pubkey: string; userId: string; username: string; name: string;
    avatarUrl: string | null; revokedAt: number | null;
  }>;
  relays: string[];  // 既存の運用設定 getChatRelays() を共用
}
```

- **403 は一律 `forbidden`**。部屋の有無で応答を変えない（存在の秘匿は「非 staff には
  常に同じ 403」で担保。roomId・鍵・メンバーのどれも staff 以外に返る経路が無い）
- ポーリング: クライアントは既存チャットと同様に payload を定期取得し、
  ローテーション（keys の増加）・メンバー変化・自分の資格喪失（403 になる）を拾う
- 部屋の作り直し（participant チャットの DELETE /chat-channel 相当）は**作らない**。
  あちらはリレー上の kind:40 が消えた事故の復旧用で、こちらは kind:40 を使わないため
  その事故が構造的に起きない

### 8.1 サーバーに増える処理

- `generateChatKey()`（`lib/nostrSign.ts`）を signer 生成に再利用
- グループ共通鍵の生成: `crypto.getRandomValues(new Uint8Array(32))` → hex。
  暗号処理はサーバーには無い（NIP-44 の暗号・復号はブラウザだけが行う）

---

## 9. 画面

### 9.1 既存チャットとの共存: **別の部屋として並べる**（決めること4）

1つの部屋がフェーズで公開⇔非公開に切り替わる形は採らない。

- 切り替えだと「公開の瞬間に、公開前の相談ログが参加者向けの部屋に載る/消える」の
  どちらかを選ぶことになり、どちらも事故（漏れ or 消失）
- スタッフ部屋は準備〜振り返りまで生き続ける長命な場で、参加者チャットは
  開催時間帯の社交場 (#199)。**寿命も対象も違う2つの部屋**が正しいモデル

公開後のスタッフには「チャット」（参加者向け）と「スタッフチャット」が並ぶ。

### 9.2 構成（EventChat.tsx には足さない #360）

| ファイル | 内容 | 目安 |
|---|---|---|
| `apps/web/src/pages/StaffChatPage.tsx`（新規） | `/events/:id/staff-chat`。myRole === "staff" 以外にはリンクも出さず、直接開かれたら 403 相当の案内 | 〜100行 |
| `apps/web/src/components/StaffChat.tsx`（新規） | 部屋の表示・暗号化送信・復号表示。EventChat.tsx から**コピーせず**、必要最小（一時鍵固定・非表示/締め出しUI無し・投影画面無し）で書く | 〜400行 |
| `apps/web/src/api/staffChatHooks.ts`（新規） | GET/POST のフック | 〜60行 |
| `apps/web/src/lib/nostrChat.ts`（変更） | `subscribe()` と `buildChannelMessageTemplate()` に kind 引数を足す（既定 42。既存呼び出しは無変更） | +10行程度 |
| `apps/web/src/lib/staffChatCrypto.ts`（新規） | `nostr-tools/nip44` の encrypt/decrypt と v タグ・version 引きの薄い関数（純粋関数、テスト対象） | 〜80行 |

- 導線: EventDetailPage のスタッフ向けメニュー（TODO #393・裏方 #383 と同じ並び）に
  「スタッフチャット」。**myRole === "staff" のときだけ描画**（管理者UI方針に従い
  isAdmin は混ぜない）
- nostr-tools は既存同様 lazy import（メインバンドルに混ぜない）
- 復号失敗（鍵に無い version・壊れた payload）は**そのメッセージだけ非表示**。
  エラー文言に技術用語を出さない
- UI 文言: 「このチャットはスタッフだけが読めます。内容は暗号化されて外部サーバーに
  保存されます（運営サービスには内容が見えます）」程度。Nostr・NIP-44 等の
  実装技術名は出さない

### 9.3 フェーズごとの挙動（決めること・issue の要求）

| フェーズ | スタッフチャット | 参加者チャット（既存・変更なし） |
|---|---|---|
| 作成直後〜公開前（draft、日程調整中も含む） | **読み書き可**（これが本件の目的） | 存在しない |
| 公開後（published） | 読み書き可。参加者チャットと並ぶ | chatEnabled なら開設可・書き込みは開始30分前〜終了2時間後 |
| 終了後・archived | **読み書き可のまま**（振り返り・撤収連絡に使う。書き込み時間窓は設けない） | 閲覧のみ（既存仕様） |
| イベント削除 | 鍵ごと消え、誰にも復号不能（7.4） | チャンネル紐付けが消える |

参加者（staff 以外の全ロール・非メンバー・appAdmin）は**全フェーズで 403**。
イベント詳細にも一覧にもスタッフチャットの痕跡は出ない。

---

## 10. 通知・メール（決めること5）

**新着通知は出さない。**

- 本文はサーバーを一切通らず、サーバーは**投稿があった事実すら観測しない**
  （観測するにはサーバーがリレーを購読する常駐が要る。Workers にその居場所は無く、
  cron は満杯 #129）。通知を出す土台が構造的に無い
- 出せたとしても「スタッフチャットに新着」という通知行自体がイベント名と紐付いて
  通知一覧・メールに残り、露出面が増える
- 確実に届けたい連絡には既存の一斉連絡 (#172)・TODO の割り当て (#393) がある。
  チャットは「開いている人の道具」と割り切る

将来必要になったら、既読管理ではなく「最後に開いた時刻より新しい発言があるか」を
クライアント側だけで出すバッジ（リレー購読で足りる）から検討する。

---

## 11. テスト

サーバー（`staffChat.test.ts` 新規）:

1. **参加者に見えない**: participant / judge / observer / 非メンバー / appAdmin /
   pending 招待の本人 → GET・POST とも 403。**応答本文が部屋の有無で変わらない**こと
2. **鍵が漏れない**: イベント API（GET /events/:id、一覧、公開 API）の応答に
   roomId・secret・staff-chat の pubkey が現れない（serializer が別表を読まないことの確認）
3. staff は POST で部屋を作れ、GET で全 version・myKey・members が返る
4. 2人同時 POST でも部屋と v1 は1つ（先勝ち）
5. **ローテーションが効く**: 降格・参加解除・退会 purge の3経路それぞれで
   (a) keys の version が増える、(b) 対象者の signer に revoked_at が付く、
   (c) 対象者の GET が 403 になる。部屋未作成のイベントでは何も起きない
6. 再招待→承諾で revoked_at が消え、全 version を受け取れる
7. 招待の状態遷移との突き合わせ: declined / revoked / pending の各状態で 403 のまま

web（純粋関数・`staffChatCrypto.test.ts`）:

8. nip44 の暗号化→復号の往復。v タグの version で鍵を引き、無い version は
   null（描画スキップ）になる
9. revoked_at より後の created_at のメッセージが描画対象から外れる

---

## 12. やらないこと

- **#205 本体**（参加者向け非公開チャット・公開/非公開の切替）。本設計は audience 列と
  ゲート差し替えという乗り口だけ用意する
- 新着通知・メール（10.）
- メッセージの非表示・締め出し (#278/#283) 相当のモデレーション UI。スタッフ間の部屋で
  問題が起きたら降格（＝ローテーション）が対処になる
- NIP-07 本鍵での発言（5.2 のメタデータ緩和を壊すため。選択肢自体を出さない）
- 投影用画面・XP・画像アップロード等、参加者チャットの周辺機能
- リレー側の追加実装（relay29 等）を要求すること
  （NIP-70 は #460 でリレーが対応済みになったため適用した。上記 2.1）
- 部屋の作り直し・チャット ON/OFF 設定（7.1・8.）

---

## 13. 設計からの差分（実装・レビューで変えた判断）

- **マイグレーションは 0074 ではなく `0075_staff_chat.sql`**（0074 は #384 が先に使用）
- **退会申請（soft delete）もローテーション経路に加えた**（2.6 / 7.3。第三者レビューの指摘）。
  申請前に受け取った鍵は手元に生きているため、purge まで待つと猶予期間中の新規発言を
  外部クライアントで読み続けられる
- **バックデート注入の限界を明記した**（7.3 末尾。第三者レビューの指摘）。失効判定は
  `created_at`（自己申告の時刻）に依存し、時刻を偽装した書き込みの注入までは防がない
- **受信バッファのあふれ対策**（5.2）: 許可リスト外の野良投稿から先に捨てる
  `apps/web/src/lib/staffChatBuffer.ts` を追加した（あふれるまでは捨てない）
- **POST に 409 を追加**: 生成した pubkey が同じ部屋で他人に使用済みのとき（8.）。
  同時発行のレースは先勝ちで、payload の読み直しで収束する
- **SQL 監査は専用テスト**: 3表を触る SQL が `db/repositories/staffChat.ts` の外に
  無いことを `test/staff-chat-sql-audit.test.ts` が機械で守る（#384 の監査と同じ仕掛け）。
  `event_group_chat_signer` は `mergeUsers` の `uniqueKeyed` に登録し、
  `test/merge-user-columns.test.ts` (#396) が登録漏れを落とす
