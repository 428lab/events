# 出会いの達成条件で景品と引き換えられるモード (#431)

- 対象: `apps/server`（D1 スキーマ・新ルート・新リポジトリ）、`packages/shared`（型・入力・文言）、
  `apps/web`（イベントページの景品カード・スタッフの引き換えデスク・イベント編集の景品設定）
- ステータス: **実装済み**（PR #433 / issue #431）。その後の拡張:
  景品の任意画像は PR #435（issue #434）、ビンゴ景品プール（条件種別 `bingo`）は
  PR #437（issue #436）、引き換え履歴は PR #442（issue #441）。
  設計から変えた点は §7「設計からの差分」
- 前提: #418（出会いランキング、PR #432）は**マージ済み**。集計の土台
  `PER_USER_COUNTS_SQL`（`eventMeets.ts`）と `rankingForEvent` をそのまま使う
- 決定済み（issue #431 本文 + コメント 2026-08-26）:
  - 達成条件は **5人到達 / 10人到達 / 20人到達 / ランキング1位**
    （「一番で会った人」＝一番多く出会った人、で確定）
  - 達成すると**景品と引き換えできる**。**景品はイベントページに表示**
  - **交換済みチェック**（二重引き換え防止）。**在庫は早い者勝ち**

---

## 1. なぜ作るか

出会いの記録（QRの読み合い #304/#324/#330）とランキング投影（#418）で「たくさん会う」
動機は作ったが、**景品という実物の見返り**が付くとさらに強く回る。staff 用ランキングの
コメントに元から「景品配布などの運営用」とある——いまは運営が目視でやっている配布を、
条件・在庫・交換済みの管理ごと道具にする。

---

## 2. 調査結果

### 2.1 集計の土台（#418）

「1人あたりの出会い件数」は `eventMeets.ts` の `PER_USER_COUNTS_SQL` の1本に寄せてあり、
named/anonymous ランキング・本人の順位・母数がすべてこれを土台にしている
（`docs/meet-ranking.md` §3.8「同じ集計を別の場所に書かない」）。
本件の「N人到達」「1位」の判定も**この1本から導出**する。新しい集計 SQL は書かない。

- N人到達: `countedMeetsForUser(eventId, userId)`（既存）
- 1位: `rankingForEvent` と同じ `MAX(n)`（§3.4）

### 2.2 「参加者が見せる → スタッフが付ける」の先例（チェックイン #154/#286）

- QR受付: 参加者が署名付きチケットQRを見せる → staff の `CheckinPage`（スキャナ）が読む
  → `POST /:id/checkin` が検証して出席を記録
- 手動経路: `member-lookup`（username/UUID で照会）→ staff が
  `PATCH /:id/members/:userId/attendance` で付ける。**確定メンバーでなければ 409**、
  解除（外す方向）は条件を緩めて通す（誤操作を staff が直せることを優先）

引き換えもこの型に倣う: **付ける操作は staff、サーバーが条件を再検証、
外す方向（誤操作の訂正）は緩く通す**（§3.7）。

### 2.3 原子的な「早い者勝ち」の先例

- `consumeMeetToken`（#330）: 「調べてから書く」の隙間を突く並行リクエストを、
  **原子的な確保**で塞いでいる（確保できなかった＝誰かが先に読んだ）
- `db/client.ts` の `runCount` は「**条件付きUPDATEの成否判定用**」と明記されており、
  変更行数 0/1 で勝ち負けを判定する部品が既にある
- 先着枠（`participation_slot`）は「定員超過をあえて拒否しない」（#286 当日繰り上げ）
  方針なので、在庫の厳密な先例としてはトークン確保のほうが近い

在庫の確保はこの型で **D1 の1文**にする（§3.5）。

### 2.4 イベント配下の CRUD・子リソースの先例（表彰 #awards）

`routes/awards.ts`: ランク賞・特別枠の CRUD は staff 限定、**子リソースは
`cur.eventId !== c.req.param("id")` を確かめて 404**（別イベントの id を差し込む攻撃を塞ぐ。
セキュリティ点検 2026-07-03 の「子リソースの所有チェック必須」）。
公開の読み取りは `eventRoutes` のブランケット `requireAuth` を避けるため
**api に直接登録**する（`getEventAwards` の型）。景品の公開一覧も同じ形にする。

### 2.5 出会いの取り消し（#330）が集計に与える影響

`POST /api/meet/undo` は「その読み取りが書いた行」だけを `deleteMeet` で消す。
つまり**件数は減りうる**。達成を保存すると取り消しとの整合（減ったら消す？）を
自前で追いかけることになるので、**達成は保存せず読むたびに導出**する（§3.3）。
導出なら取り消しで自然に「達成が消える」。引き換え済みだけは残す（§3.6）。

### 2.6 複製・ユーザー統合・退会

- 複製（`routes/eventDuplicate.ts` `POST /:id/duplicate`）: 参加枠・採点基準・表彰・TODO を
  コピーする。景品の**定義**も同列（イベント設計の一部）なのでコピーする。
  引き換え記録・1位の確定は当然コピーしない
- `mergeUsers`（`users.ts`）: UNIQUE キーを持つ表は `uniqueKeyed` の3つ組で付け替える。
  引き換えは (prize, user) で UNIQUE、1位確定は (event, user) が PK なので**両方
  `uniqueKeyed`** に足す。`test/merge-user-columns.test.ts` が列数・組数を実数で
  固定しているので、**数字だけ直して素通りしない**こと（設計に書いておく理由）
- 退会の4通り（`docs/staff-roles.md` 2.4 の表）: 完全削除 (d) だけ FK が発火する。
  引き換え行の `user_id` は CASCADE で消える（景品イベントは当日物で、30日後の
  完全削除の時点では終わっている。在庫の導出値が 1 戻るが実害の窓が無い）。
  `redeemed_by`（付けた staff）は **SET NULL**（staff が退会しても配布の記録は消さない。
  TODO の担当者と同じ選択）

---

## 3. 設計

### 3.1 設定: `event.meet_prizes`（独立のオン/オフ）

**`event.meet_prizes INTEGER NOT NULL DEFAULT 0`（boolean）。既定オフ。**

`meet_ranking` とは**独立**にする。1位条件の判定はランキングの**集計**
（`PER_USER_COUNTS_SQL`）を使うが、それはランキングの**表示**設定とは別物
（staff 用ランキングが既に `meet_ranking` に従わないのと同じ区別）。
「ランキングは映さないが景品はやる」「ランキングだけ映す」のどちらも成立する。

- オンにすると: イベントページに景品カードが出る（公開。§3.9）
- オフのとき: **参加者向けの読み取りは 404**（イベント不存在と同一応答。#418 と同じ姿勢で
  存在ごと出さない）。**staff の設定 CRUD・引き換えデスクはオフでも動く**
  （開催前に景品を仕込んでおき、当日オンにする運用のため。門の述語は1つ。§3.9）
- 3値 enum にしない: #418 は「出す/出さない × 名前/匿名」の2軸を1列に畳む必要が
  あったが、本件の公開情報は景品の定義だけで見せ方の軸が無い。boolean で足りる

shared（`packages/shared/src/schema.ts`）: `eventSchema` に `meetPrizes: z.boolean()`、
`updateEventInput` に optional で追加（`createEventInput` には入れない。`chatEnabled` 等と同じ）。
複製のコピーリストにも足す。

### 3.2 データモデル: 定義・引き換え・1位確定の3表

マイグレーション `apps/server/migrations/0079_meet_prizes.sql`
（SQL のコメント行は要約。DDL 本文は migration と同一）:

```sql
-- 景品引き換えモード (#431)。オンでイベントページに景品を表示
ALTER TABLE event ADD COLUMN meet_prizes INTEGER NOT NULL DEFAULT 0;

-- 景品の定義（イベントごとに主催者が作る）
CREATE TABLE event_prize (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  condition_type TEXT NOT NULL,   -- 'meet_count' | 'top_rank'
  threshold INTEGER,              -- meet_count のとき必要人数（1以上）。top_rank は NULL
  stock INTEGER NOT NULL,         -- 在庫総数（0以上。残数は引き換え行から導出）
  created_at INTEGER NOT NULL,
  -- 「meet_count なのに人数が無い / top_rank なのに人数がある」行を作れなくする。
  -- NULL の解釈（1? 無限?）をコードに2つ作らないための、状態そのものの排除。
  -- 否定形で書いてあるのは、条件の種別を将来足すときにテーブル再構築を要しないため
  CHECK ((condition_type <> 'meet_count' OR threshold IS NOT NULL)
     AND (condition_type <> 'top_rank' OR threshold IS NULL))
);
CREATE INDEX idx_event_prize_event ON event_prize(event_id);

-- 引き換えの記録（= 交換済みチェック。1景品につき1人1回）
CREATE TABLE event_prize_redemption (
  id TEXT PRIMARY KEY,
  prize_id TEXT NOT NULL REFERENCES event_prize(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  redeemed_by TEXT REFERENCES user(id) ON DELETE SET NULL,  -- 付けた staff（記録用）
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_event_prize_redemption_user
  ON event_prize_redemption(prize_id, user_id);

-- ランキング1位の確定（締めた時点のスナップショット。同率なら複数行）
CREATE TABLE event_meet_winner (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  count INTEGER NOT NULL,     -- 締めた時点の件数（表示用）
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
```

- `0080_meet_prize_images.sql`（#434）で `event_prize` に **`image_key TEXT`** を追加
  （R2 のオブジェクトキー。NULL＝画像なし。キーはアップロードごとに新しく振る。§7）
- 条件は **`meet_count`（N人到達。N は自由入力）と `top_rank`（1位）の2種**で始め、
  #436 で **`bingo`（ビンゴ達成。ビンゴ景品プール）** が加わり3種（TEXT 列なので
  マイグレーション不要。`bingo` の threshold NULL 強制は上の CHECK では縛れないため、
  shared の zod `thresholdMatchesCondition` が正の門。詳細は §7 と `docs/bingo.md`）。
  5/10/20 は編集UIの**既定候補（プリセットボタン）**であって DB 上の制約ではない。
  「3人で参加賞」「50人の猛者賞」もイベント規模に合わせて作れる。
  同じ閾値の景品を複数作ることも止めない（UNIQUE を張らない）
- **在庫の残数・達成済みかは列に持たない。** 残数は `stock - COUNT(redemption)`、
  達成は件数から、そのつど導出する（「充足は保存せず導出」`docs/staff-roles.md` 3.7 と同じ。
  保存すると #330 の取り消しや在庫訂正のたびに整合を追いかける2つ目の契約になる）
- `threshold` の入力検証は 1〜1000。`stock` は 0〜1000。
  名前 100 字・説明 500 字（awards の入力と同水準。`packages/shared/src/meetPrizes.ts` の zod）。
  景品数はイベントあたり最大 20
  （`MEET_PRIZE_MAX` を shared に。条件数種×数個で足りる。無制限だと公開ページに並ぶ）

### 3.3 達成の判定は導出（保存しない）

- **`meet_count`**: `countedMeetsForUser(eventId, userId) >= threshold` を読むたびに評価。
  **即時判定**（QRを読み合った瞬間に達成が画面に出る）
- **`top_rank`**: `event_meet_winner` に行がある人だけが達成（§3.4）。締めるまでは誰も未達成

達成を行として保存しない理由:

1. #330 の取り消しで件数は**減る**。保存すると「減ったら消す」処理が取り消し側に増える
   （取り消しの経路は scan/undo の1本に閉じてあるのに、そこへ景品の後始末が漏れ込む）
2. 「達成した」に固有の情報が無い（いつ達成したかは景品の要件に無い。要るのは
   「引き換えたか」で、それは redemption 行が持つ）
3. 在庫は**引き換えた順**で確保する（§3.5）ので、達成時点で何かを予約する必要が無い

### 3.4 1位の確定: 主催者が「締める」

順位はイベント中入れ替わり、記録の窓は終了2時間後まで開いている
（`MEET_WINDOW_AFTER_MS`）。自動で「いつの1位」を選ぶ規則を作るより、
**主催者が締める操作をして、その瞬間の1位を確定**させる（issue 本文も「主催者が
締める操作をする、が安全」）。表彰のタイミング（結果発表・懇親会の頭）は
イベントごとに違うので、人間が決めるのが正しい。

`POST /api/events/:id/meets/winners/close`（staff）。実装は `closeWinners()`
（`db/repositories/eventMeetPrizes.ts`）。先に `PER_USER_COUNTS_SQL` で母集団の有無を
確かめ（0 なら**何も消さずに**断る）、その後:

```sql
-- batch() で2文をアトミックに（締め直し＝全置換）
DELETE FROM event_meet_winner WHERE event_id = ?;
INSERT INTO event_meet_winner (event_id, user_id, count, decided_at)
SELECT ?, t.id, t.n, ?
  FROM (PER_USER_COUNTS_SQL) t
 WHERE t.n = (SELECT MAX(n) FROM (PER_USER_COUNTS_SQL) t2);
```

- **同率1位は全員が勝者**（複数行入る）。競技順位（#418 §3.6）と同じ考え方で、
  「先に達した方」のような時刻比較は導入しない（`created_at` はペアの行にしか無く、
  何件目で並んだかの比較は恣意的になる）。同率複数×在庫1なら、引き換えは
  在庫の早い者勝ち（§3.5）がそのまま適用される。UI は締めた結果
  「1位 3人（同率）」を staff に見せ、在庫を積み増すかは主催者の裁量
- **締め直しは何度でもできる**（全置換）。締めた後に取り消し（#330）で順位が
  変わったと分かったら締め直せばよい。**ただし引き換え済みの行には触らない**（§3.6。
  景品は物理的に渡っている）。締め直しで勝者から外れた未引き換えの人は達成が消える
- `DELETE /api/events/:id/meets/winners`（staff）で未確定に戻せる（誤操作用）
- 0件（誰も出会っていない）での締めは **409 `no_meets`**。「確定済みか」を winner 行の
  有無で表すため、勝者0人の「確定済み」という状態を作らない。母集団の確認は DELETE
  より**先**に行い、既存の確定には触らない（締めた後に出会いが全部取り消された状態から
  締め直しても、勝者が黙って消えない）
- 記録の窓はイベント終了2時間後に自然に閉まる（#418 §3.7 と同じ理屈）ので、
  「締めた後も QR を読み合える」こと自体は問題にしない——締め＝景品の確定であって
  記録の停止ではない。締めた後の記録はランキングには映るが1位の景品には効かない

### 3.5 在庫は「引き換えた順」の早い者勝ち

**在庫を消費するのは達成ではなく引き換え。** 達成した順に自動確保すると、
来ない人・要らない人が在庫を握って窓口に来た人が受け取れない。要件の
「早い者勝ち」は窓口での**引き換えた順**と解釈する（達成順の予約は作らない）。

二重引き換えと在庫超過は**1文の INSERT**で同時に塞ぐ（`runCount` の型）:

```sql
INSERT INTO event_prize_redemption (id, prize_id, user_id, redeemed_by, created_at)
SELECT ?, ?, ?, ?, ?
 WHERE NOT EXISTS (SELECT 1 FROM event_prize_redemption
                    WHERE prize_id = ? AND user_id = ?)
   AND (SELECT COUNT(*) FROM event_prize_redemption WHERE prize_id = ?)
       < (SELECT stock FROM event_prize WHERE id = ?)
```

- SQLite/D1 は**1文が原子的**。「数えてから入れる」を2文に分けると、残り1個に
  同時到達した2窓口が両方通る（`consumeMeetToken` のコメントと同じ罠）。
  UNIQUE インデックスは二重引き換えの**最後の砦**として残す
- 変更行数 0 のときは読み直して理由を分ける: 行が既にある → `already_redeemed` 409 /
  無い → `out_of_stock` 409（窓口の staff が参加者に案内する文言が変わる）
- staff が在庫数を後から**減らして**引き換え済み数を下回っても壊れない
  （条件が満たせなくなるだけ。残数表示は 0 に丸める）
- 引き換えの**取り消し**（`DELETE .../redeem/:userId`、staff）で在庫は自然に 1 戻る
  （導出なので何も更新しない）。誤操作訂正用で、出席チェックの解除と同じく
  外す方向は緩く通す

### 3.6 出会いの取り消し（#330）との関係

| 状態 | 取り消しで件数が閾値を下回ったら |
|------|------|
| 未引き換え | **達成が消える**（導出なので自動。引き換えできなくなる） |
| 引き換え済み | **そのまま**（redemption 行には触らない。景品は物理的に渡っている） |

引き換えの API はその時点の件数で達成を検証する（§3.7）ので、「達成画面を見た直後に
取り消しで下回った」ケースも窓口で正しく 409 になる。逆流（redemption を消して回る）は
作らない——取り消しの責務は出会いの行だけ、景品の責務は redemption だけ、と互いに閉じる。

### 3.7 引き換えの流れ（チェックインの型）

```
参加者: イベントページの景品カードに「達成」バッジ（名前・アバター付きの引換画面）
   ↓ 窓口でスタッフに見せる
スタッフ: 引き換えデスク画面（達成者一覧・検索）で本人の行を開く
   ↓ 景品を渡して「交換済みにする」
サーバー: 達成を再検証 → §3.5 の1文で在庫確保 → 交換済みに
```

- **付けるのは staff だけ**（`requireEventRole(["staff"])`）。参加者の自己申告 POST は
  作らない（物を渡すのは staff なので、押す人と渡す人を一致させる。出席チェックと同じ）
- サーバーは引き換え時に**達成を再検証**する（`meet_count`: 現在の件数 >= threshold /
  `top_rank`: winner 行の存在 / `bingo`: ゲームとカードからの導出 #436）。
  画面に出ていたかは信用しない
- 対象は**確定メンバーのみ**（attendance と同じ 409 `not_confirmed`）
- 本人確認は「参加者が自分の達成画面（名前・アバター入り）を見せ、staff が一覧の
  名前と突き合わせる」で足りる（v1）。チェックインの署名付きQRを読む厳密な型は、
  デスク画面が `CheckinPage` のスキャナ部品と `member-lookup` を流用すれば後から足せる
  （§6）。受付と違い引き換えは1人ずつ会話しながらなので、なりすましの割は合わない

### 3.8 API 一覧

すべて `routes/eventMeetPrizes.ts`（新規。`eventMeets.ts` は既に大きく、責務も
「記録・ランキング」と「景品」で分かれる）。公開の2本（一覧・画像）は
`worker.ts` で api に直接登録する（awards の `getEventAwards` と同じ型）。

| メソッド/パス | 誰が | 何をする |
|---|---|---|
| `GET /api/events/:id/meet-prizes` | 公開(イベントが見られる人。未ログイン可) | 景品一覧 + 残数 + 画像URL + 1位確定済みか。ログイン済み確定メンバーには `me`（自分の件数・1位か・ビンゴ達成か・受け取り済み履歴）も返す。**`meet_prizes` オフなら staff にも 404**（存在ごと隠す門。§3.9） |
| `GET /api/events/:id/meet-prizes/:prizeId/image` | 公開（同上。#434） | 景品画像の配信（R2 ストリーム + MIME 許可リスト + nosniff + ETag）。オフのとき staff だけは例外で見られる（仕込み中のプレビュー用。共有キャッシュには置かせない） |
| `POST /api/events/:id/meet-prizes` | staff | 景品作成（`name`/`description`/`conditionType`/`threshold`/`stock`）。上限 `MEET_PRIZE_MAX` 超で 409 `too_many` |
| `PATCH /api/events/:id/meet-prizes/:prizeId` | staff | 更新（子リソースの eventId 所有チェック → 不一致 404。全項目送りの非部分更新） |
| `DELETE /api/events/:id/meet-prizes/:prizeId` | staff | 削除（redemption は CASCADE。画像の R2 オブジェクトもここで削除。引き換え済みがあれば UI で警告） |
| `PUT /api/events/:id/meet-prizes/:prizeId/image` | staff | 画像アップロード（生バイナリ。MIME 許可リスト + マジックバイト検査 + `MEET_PRIZE_IMAGE.maxBytes`＝1MB。#434） |
| `DELETE /api/events/:id/meet-prizes/:prizeId/image` | staff | 画像の削除（参照を外してから R2 を best-effort で削除。#434） |
| `GET /api/events/:id/meet-prizes/list` | staff | 定義一覧だけの軽い口（編集画面用。達成者・在庫の集計はしない。オフでも動く） |
| `GET /api/events/:id/meet-prizes/log` | staff | 引き換え履歴（全景品種別・新しい順・上限100。#441） |
| `GET /api/events/:id/meet-prizes/status` | staff | 引き換えデスク用: 景品ごとの達成者一覧（名前・件数・交換済みか・残数）+ 確定済み勝者 + ビンゴ景品プールの達成者（#436）。達成者は `PER_USER_COUNTS_SQL` と winner 行から導出 |
| `POST /api/events/:id/meet-prizes/:prizeId/redeem` | staff | `{ userId }` を交換済みに（§3.5 の1文。`bingo` はプール全体で1人1回の別の1文）。409: `already_redeemed` / `out_of_stock` / `not_achieved` / `not_confirmed` |
| `DELETE /api/events/:id/meet-prizes/:prizeId/redeem/:userId` | staff | 交換済みの取り消し（誤操作訂正。在庫が戻る） |
| `POST /api/events/:id/meets/winners/close` | staff | 1位を確定（全置換。0件は 409 `no_meets`。§3.4） |
| `DELETE /api/events/:id/meets/winners` | staff | 確定を取り消して未確定に戻す |

staff 系はオン/オフに**従わない**（準備・後片付けで使う。staff 用ランキングと同じ姿勢）。
リポジトリは `db/repositories/eventMeetPrizes.ts`（新規）。達成判定・残数の導出は
ここに閉じ、`PER_USER_COUNTS_SQL` は `eventMeets.ts` から import する（集計を2か所に書かない）。

### 3.9 参加者に見える範囲（経路表）

| 経路 | 見える人 | 見える内容 |
|------|---------|-----------|
| `GET /:id/meet-prizes`（公開） | イベントを見られる全員 | 景品名・説明・条件・**残数**・画像URL。個人を指す値は一切載せない（1位も「確定済みか」の bool だけで**勝者名は載せない**。#418 匿名モードと同じ責務分担: 落とすのはサーバー） |
| 同上の `me` | 本人（確定メンバー） | 自分の件数・1位か・ビンゴ達成か・受け取り済み履歴 |
| `GET /:id/meet-prizes/:prizeId/image`（公開 #434） | 一覧と同じ相手（門の述語 `meetPrizeAudience` を共用） | 景品画像。オフのとき staff だけは例外で見られる（プレビュー用。`private` キャッシュ） |
| `GET /:id/meet-prizes/status`・`/log` | staff のみ | 達成者・引き換え履歴の名前・件数・交換状況（配布運営に必要） |

- **他人の達成状況・交換状況は参加者に見せない**（誰が何個交換したかは競争を
  煽る情報ではなく個人の行動記録。#418 が名前入りランキングを設定の門の内側に
  置いたのと同じ慎重さ）。1位の勝者名も、`meet_ranking = named` のイベントなら
  ランキング画面で実質分かるが、**景品の公開応答には混ぜない**（契約を1つに保つ）
- 残数は公開する（「残り2個」が早い者勝ちの動機そのもの。在庫切れは
  「なくなりました」表示にして景品自体は消さない——何が出ていたかは残す）
- オフ→404 の門の述語はサーバー側の**1つ**（`meetPrizeAudience`。公開一覧と画像 GET が
  共用）。Web 側の出し分けは利便であって防御ではない（#418 §3.8 と同じ）

### 3.10 画面

| 画面 | 場所 | 内容 |
|------|------|------|
| 景品カード（参加者・公開） | `EventDetailPage` に追加（`components/MeetPrizes.tsx` の `MeetPrizePanel`） | 景品一覧（条件・残数・在庫切れ表示・画像）。確定メンバーには自分の件数の文・達成バッジ・「交換済み」表示（進捗バーは無し）。達成があると「スタッフに見せて受け取ってください」の案内 |
| 引き換えデスク（staff） | `/events/:id/prize-desk`（新規 `EventPrizeDeskPage.tsx`。`EventTodoPage` と同じ `EventLayout` 子ルート + 詳細ページに導線ボタン） | 景品ごとの達成者一覧（検索つき）・「交換済みにする/戻す」・残数・**「1位を確定する」ボタン**（確定済みなら勝者と締め直し）。`MEET_RANKING_POLL_MS`（5秒）で再取得し、窓口で読み合った直後の達成が出る |
| 景品の設定（staff） | `EditEventPage` にセクション追加（`components/MeetPrizeEditor.tsx`） | オン/オフのスイッチ + 景品の CRUD（条件セレクト: 「N人と出会う」（プリセット 5/10/20 + 自由入力）/「ランキング1位」/ビンゴ、在庫数、画像）。並び順の入力は無し（作成順で並ぶ）。表彰・参加枠の編集UIの型 |
| `EventStatsPage` | `MeetRankingCard` | 引き換えデスクへのリンクを1つ足す（「景品配布などの運営用」の注記が既にあり、行き先ができる） |

### 3.11 i18n・文言

- 参加者向け（`eventSocial.ts`）: 景品カードの見出し・条件の文
  （「5人と出会うと」「出会った人数ランキング1位」）・自分の件数・達成・交換済み・在庫切れ
- 編集画面（`eventForm.ts`）: オン/オフのスイッチ・景品 CRUD・画像の文言
- staff 向け（`staffOps/prizes.ts`）: デスク画面・締め操作の確認・409 の案内文言
  （交換済みです/在庫がありません/条件を満たしていません/参加が確定していません）
- UI に実装技術の語を出さない・競合名を書かない（既存方針どおり）

---

## 4. 変更ファイル一覧

| 層 | ファイル | 変更 |
|----|---------|------|
| DB | `apps/server/migrations/0079_meet_prizes.sql` | 新規。`meet_prizes` 列 + 3表（§3.2） |
| DB | `apps/server/migrations/0080_meet_prize_images.sql` | 新規。`event_prize.image_key`（#434） |
| shared | `packages/shared/src/meetPrizes.ts` | 新規。条件 enum・入力スキーマ・`MEET_PRIZE_MAX`・`MEET_PRIZE_IMAGE`・応答型・画像URLの組み立て |
| shared | `packages/shared/src/schema.ts` | `eventSchema`/`updateEventInput` に `meetPrizes` |
| server | `db/repositories/events.ts` | 行マッピング・UPDATE に `meet_prizes` |
| server | `db/repositories/eventMeetPrizes.ts` | 新規。CRUD・達成/残数の導出・§3.5 の確保・§3.4 の締め・履歴（#441）・ビンゴプール（#436） |
| server | `routes/eventMeetPrizes.ts` | 新規。§3.8 の一覧（公開の2本は `worker.ts` で api 直登録） |
| server | `routes/eventDuplicate.ts` | 複製のコピーリストに `meetPrizes` 設定 + 景品定義・画像のコピー |
| server | `db/repositories/users.ts` | `mergeUsers` の `uniqueKeyed` に redemption・winner を追加。`redeemed_by` も付け替え |
| web | `pages/EventPrizeDeskPage.tsx` | 新規。引き換えデスク（§3.10） |
| web | `components/MeetPrizes.tsx` | 新規。参加者向け景品カード（`MeetPrizePanel`） |
| web | `components/MeetPrizeEditor.tsx` | 新規。景品 CRUD + 画像アップロード |
| web | `pages/EventDetailPage.tsx` / `components/EventActionButtons.tsx` | 景品カード + staff 導線 |
| web | `pages/EditEventPage.tsx` | オン/オフ + 景品 CRUD セクション |
| web | `pages/EventStatsPage.tsx` | デスクへのリンク |
| web | `api/meetPrizeHooks.ts` | 新規。景品の query/mutation 一式（`MEET_RANKING_POLL_MS` の5秒ポーリング） |
| i18n | `eventSocial.ts`・`eventForm.ts`・`staffOps/prizes.ts` | ja/en 追加 |
| test | `merge-user-columns.test.ts` | 実数の更新（理由をコミットに書く） |
| test | `meet-prizes.test.ts`・`meet-prize-images.test.ts` | 新規。§5 の観点 |

## 5. テスト観点（server）

- **二重引き換え**: 同じ (prize, user) の2回目が `already_redeemed` 409。
  §3.5 が**1文の INSERT**であること（2文に割ると原子性が消える）をコメントとテストで固定
- **在庫の競合**: stock=1 で2人目が `out_of_stock` 409。stock=0 の景品は最初から引き換え不可。
  在庫を引き換え済み数より減らしても残数が負にならない（表示は 0 に丸め）
- **達成の検証**: threshold ちょうどで可・1未満で `not_achieved`。`top_rank` は締め前
  `not_achieved`・締め後は winner のみ可。未確定メンバーは `not_confirmed`
- **取り消しとの絡み**: 引き換え後に #330 の undo で件数が閾値を下回っても redemption は
  残る。未引き換えなら `me.count` が減って達成表示が消え、redeem が 409
- **1位の締め**: 同率で複数行・締め直しで全置換・0件は 409 `no_meets`（既存の確定に
  触らない）・winner の DELETE で未確定に戻る
- **オフ時の隠蔽**: `meet_prizes=0` で公開 GET が 404（存在しないイベントと同一応答）。
  staff 系はオフでも通る。公開応答に userId・勝者名など個人を指す値が**含まれない**こと
- **子リソースの所有チェック**: 別イベントの prizeId で PATCH/DELETE/redeem → 404
- **複製**: 景品定義はコピー・redemption/winner はコピーしない
- **mergeUsers**: redemption と winner が統合先に付け替わる（衝突時は片方が残る）

## 6. やらないこと（今回の範囲外）

- **達成順の在庫予約**（早い者勝ちは引き換えた順。§3.5 の理由）
- **達成の push 通知**（scan の応答画面と景品カードで足りるとみて v1 では見送り。
  「達成したのに引き換えに来ない」が実際に起きたら、scan 後の閾値跨ぎ検出で足せる）
- **署名付きQRによる引き換えの本人確認**（§3.7。デスク画面が checkin の部品を
  流用できる形にはしておく）
- **条件の追加種別**（「特定の人と会う」「スタッフ全員と会う」等は範囲外。
  `condition_type` を enum にして拡張に耐える形にしてあり、実際に #436 で
  `bingo` が追加された。§7）
- **ランキング投影ページへの景品表示の混在**（投影は #418 の責務のまま）

## 7. 設計からの差分

レビュー・実機確認・後続PRで設計から変えた点（いずれもコードで確認済み）:

実装時（PR #433）のレビュー・実機反映:

- **`sort_order` 列は持たない**（誰も設定できない値を5層に貫通させない。並び順は
  作成順 `ORDER BY created_at ASC, rowid ASC`。並び替えが要るときに足す）
- **threshold と条件の整合を CHECK 制約でも強制**（§3.2。入力の zod と DB の二段）
- **0件での締めは 409 `no_meets`**（§3.4。勝者0人の「確定済み」を作らず、母集団の
  確認を DELETE より先にして既存の確定に触らない）
- 公開一覧の `me` は `{ count, won, bingo, redemptions }`（`MeetPrizeMe`）。達成の表示は
  クライアントが導出する（判定の正は引き換え時のサーバー再検証で変わらず）
- 参加者カードの**進捗バーは未実装**（自分の件数の文のみ）
- デスク画面のルートは `/events/:id/prize-desk`（`EventPrizeDeskPage`）
- オフの隠蔽の門は述語1つ（`meetPrizeAudience`）に寄せ、公開一覧はオフなら
  **staff にも 404**（staff の例外が効くのは staff 用ルートと画像 GET だけ）
- デスクの引き換え記録はイベント単位で1回だけ引く（`redemptionsForEvent`。
  達成者×景品の N+1 回避）

後続PRでの拡張:

- **景品に任意の画像**（issue #434 / PR #435）: `event_prize.image_key`（0080）に R2 の
  オブジェクトキー。アップロード PUT / 削除 DELETE / 公開 GET（§3.8）。MIME 許可リスト
  ＋マジックバイト検査＋1MB 上限（`MEET_PRIZE_IMAGE`）。キーはアップロードごとに
  新しく振り（差し替えの取り違えと複製時の共倒れを防ぐ）、複製では画像もコピーする
- **ビンゴ景品プール**（issue #436 / PR #437）: 条件種別に `bingo` を追加。この種別の
  景品は「プール」で、達成者は在庫のあるプール景品から**1つ選ぶ**（プール全体で
  1人1回。`redeemFromBingoPool` の1文で塞ぐ）。達成はビンゴのゲームとカードから
  読むたびに導出し、達成順の裁定はサーバーでは行わない（同着の裁定は現場。
  `docs/bingo.md`）
- **引き換え履歴**（issue #441 / PR #442）: staff 用 `GET …/meet-prizes/log`
  （全景品種別・新しい順・上限100）と、公開一覧 `me.redemptions` の時刻付き化
