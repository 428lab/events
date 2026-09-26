# イベントの割り勘（費用精算）

- 対象: `apps/server`（D1 スキーマ・新リポジトリ・新ルート・退会/統合の登録）、
  `packages/shared`（型・入力・按分の純関数・文言）、`apps/web`（イベント詳細のカード・専用ページ）
- ステータス: **設計案**（issue #556。本改訂 = 支払記録の撤去。実装側はこれに追随する）。設計レビュー（必須 9）と UX レビュー（必須 6）を反映済み
- 前提となる決定（ユーザー要望 + §8.1 の確定事項 9 件）:
  - **払った金額と、誰が立て替えたか**を登録できる
  - Walica（イベント単位の割り勘 Web サービス）を**強化する**位置づけ
  - **帳簿の金額は円だけ**（§3.2）
  - **機能のオン/オフ設定を持たない**。確定メンバーなら誰でも最初の1件を登録できる（§3.3 / §3.9）
  - **受け取り先として保存するのは URL と Lightning だけ。銀行口座は保存しない**（§3.6）
  - **端数は全部、立て替えた人が持つ**（§3.4）
  - **退会した人の行は「退会済みユーザー」名義で残し、他人の金額を動かさない**（§3.3）
  - **アカウントの無い人（同伴者・飛び入り）は初回では扱わない**（§6。代替は「重み 2」）
  - **支払った／受け取ったの状態を持たない。計算機に徹する**（§3.1 / §6）
- **絶対の前提**: このアプリは**送金も金銭の預託も為替の換算も一切しない**。持つのは立替の帳簿と、そこから導いた精算、受け取り先の掲示だけ（§3.1）

---

## 1. なぜ作るか

イベントは終わったあとに「会場費・打ち上げ・備品を誰が立て替えて、誰がいくら返すのか」が必ず残る。
いまはそこだけ外部サービス（Walica 等）や LINE のやりとりに逃げていて、**参加者名簿と切り離される**。
外に出た瞬間に、メンバーを手で打ち直し、名前の表記ゆれで取り違え、出席していない人まで頭数に入る。

events lab には**実アカウントの参加者名簿・出席チェック**が既にある。
割り勘をこの上に載せると、次のことができる:

- 頭数は名簿から取る（手入力なし・同姓同名の取り違えなし）
- **「出席した人で割る」が1操作**で初期チェックになる（出席チェック #154/#286 がある）
- 精算の1行ごとに「**どの立替から、この額になったか**」を辿れる（§3.5）
- 受け取り先は**受け取るために公開する識別子だけ**を扱い、**口座情報の置き場をそもそも作らない**（§3.6）

「Walica を強化する」の中身はここ。単なる割り勘計算機の再実装ではなく、
**名簿・出席を持っている側が書く割り勘**にする。ただし**計算機であることは変えない**。
実際の支払いは PayPay・銀行・Lightning ウォレットで行われ、アプリはそれを知らない（§3.1）。

---

## 2. 調査結果（乗る土台と、乗らない判断）

### 2.1 いまのデータに金銭を扱う表は無い

`apps/server/migrations/` を 0001〜0095 まで見た。**金額・通貨・支払いに相当する列も表も無い。**
`event` にも参加費の列は無く（`packages/shared/src/schema.ts` の `eventSchema` に fee 系フィールドなし）、
参加費は現状「説明文に書く」運用。よって既存表への相乗りは検討の余地がなく、新しい表を立てる。

### 2.2 乗る先例

| 先例 | 何を借りるか |
|---|---|
| 景品 (#431 `docs/meet-prizes.md`) | 子リソースの `eventId` 所有チェック→404、**導出できる値は列に持たない**、**1文の条件付き INSERT で上限を守る**、CHECK 制約で不正な状態を作れなくする |
| 開催前アンケート (#444 `docs/pre-event-survey.md`) | **サーバー側で落とす**（クライアントで伏せるのは偽の防御）、応答に載せてよいものを列挙で決める |
| 参加枠 (`routes/eventSlots.ts`) | 子リソースの `loadXxx()` で親一致を確かめてから触る型 |
| 書き込みガード (`db/repositories/eventWriteGuard.ts`) | `eventWrite(writer, stmts)`: 閲覧権・参加状態・退会申請中でないことを**同じ batch の先頭で再確認**し、崩れていたら 409 `access_changed` |
| 退会・統合 (`userTables.ts` / `accountDeletion.ts` / `accountMerge.ts`) | ghost（退会済みユーザー）への付け替え、統合前の衝突行の**先行削除**（`user_follow` (4) の型） |
| 純関数のテスト (`apps/server/test/chat-text.test.ts`) | shared の純関数（`splitByUrls`）を server のテストから import して直接試す先例 |

### 2.3 ロール・参加状態・権限の関数（そのまま使う。コードで確認済み）

- ロール: `participant` / `staff` / `judge` / `observer`（`packages/shared/src/constants.ts`）
- 参加状態: `confirmed` / `waitlist` / `applied` / `lost` / `canceled`
- `requireEventRole(["staff"])` はアプリ管理者とコミュニティ owner/admin も通す（`auth/roles.ts`）。
  **本機能では使わない**。他人の立替・受け取り先を消すのはイベント内のモデレーションに当たるので、
  #275 の方針どおり **`isConfirmedEventStaff`（そのイベントの confirmed staff だけ）** を使う
- `/api/events/:id/*` には `requireEventAccess`（`canViewEvent`。#526 のアクセス剥奪に追随）が
  **既に前段で登録されている**（`worker.ts:154`）。本機能のルートもこの下に置く
- `eventMembersRepo.find` は `status <> 'canceled'` しか除かない（`eventMembers.ts:84`）。
  そのためイベント詳細の `myRole`（`eventsPublic.ts:92`）は applied / waitlist / lost の人にも入る。
  **確定しているかの判定は web では `useEventChatAccess` の `canChat`**（`status === "confirmed"`）が既にある
- 再参加で `event_member.created_at` は**今の時刻に上書きされる**（`eventMembers.ts:127`）。
  このため参加登録順は**計算の順序キーに使えない**（§3.4 はこれに依存しない形にした）

### 2.4 Lightning / Nostr の現状

Nostr ログイン（NIP-07）とイベントチャットは実装済みだが、**Lightning の実装は1行も無い**
（`lnurl` / `lightning` / `sats` の該当コードなし）。
本機能で入れる Lightning は「**受け取り先の文字列**」だけで、ウォレット連携・invoice 発行・
LNURL の解決・sat 建ての金額の保存はしない。

---

## 3. 設計

### 3.1 法務上の線引き（最初に決める。ここから外れる実装をしない）

日本では、他人の間の資金の移動を業として引き受けると**資金移動業**（資金決済法）の登録が要る。
預り金・収納代行に見える形も同じ危険を持つ。個人開発のイベントツールが踏んではいけない線なので、
**機能の形そのもので踏まないようにする**。

**このアプリがやること: 立替の帳簿（誰が・いくら・何に立て替えたか）を持ち、そこから精算
（誰が誰にいくら返すか）を計算して見せること。受け取り先の掲示（リンク・QR）をすること。それだけ。**

**やらないこと（実装として禁止。将来の追加提案もここに照らして却下する）:**

1. **金銭を受け取らない・預からない・送らない。** 決済 API を呼ばない。ウォレットを持たない
2. **決済事業者のウィジェット・SDK を埋め込まない。** 受け取り先は**外部リンクを開くだけ**
   （`target="_blank" rel="noopener noreferrer"`）。アプリ内で支払い画面を描かない
3. **Lightning の invoice を作らない・LNURL を解決しない。** LN Address / LNURL は
   **文字列として表示し、`lightning:` URI と QR にするだけ**（QR 生成はクライアント側。`qrcode` は既に依存にある）
4. **為替・レート・換算を一切持たない。** 帳簿の金額は**円だけ**（§3.2）。レートを持った瞬間に
   「いつのレートか」「誰がその差損を負うのか」という**アプリの説明責任**が生まれる。
   **持たなければ、そもそも説明する責任も発生しない**
5. **銀行口座（口座番号・名義）を保存する欄をアプリに作らない**（§3.6）。
   資金の受け皿そのものを保管しないので、**漏えいしても振込先として悪用できる情報が出ない**。
   **4 と 5 で、アプリが持つ金銭関連のデータは「誰が誰にいくらの貸し借りか」という数字だけ**になる
6. **手数料を取らない。**
7. **支払いの事実を記録しない**（当事者の自己申告も持たない）。**アプリが持つのは立替と負担から導いた計算結果だけ。**
   「入金確認」も「済み／未」の管理もしない。回収できたかは各自が PayPay・銀行・ウォレットの側で確かめる
8. **主催者が参加費をまとめて集める導線を作らない。**「参加費を請求する」「未払い者を締め出す」は作らない
9. **督促を代弁しない。** 未精算の人へアプリから通知を送らない（§6）

7 でこの線引きは一段強くなった。旧案では自己申告の「支払った」を持っていたため、画面の上では
「このアプリで支払いが進む」ように見える面が残っていた。**支払いに関する状態を1つも持たない**ことで、
アプリが扱うのは立替の登録と割り算の結果だけになり、資金の移動に関与している外観そのものが消える。
実装も軽くなる（表 1・API 2・権限行 3・退会/統合の付け替え 2 列が減る）。

UI の言葉は §3.10 の**禁止語の一覧（1か所）**に従う。

### 3.2 通貨: **円のみ**（採用）

**帳簿の金額は JPY 単一。`currency` 列を持たない。通貨という概念を設計から落とす。**

| 案 | 内容 | 評価 |
|---|---|---|
| 案A: 円のみ（**採用**） | 金額は整数の円。Lightning は**受け取り先の種別としてだけ**残す | ◎ 表も計算も UI もひとつ。◎ §3.1-4 の「換算を持たない」が構造的に保証される。△ sat で割り勘したい会は、円で帳簿を付けて sat で送る（払う人が自分で換算） |
| 案B: 通貨ごとに独立した帳簿 | `expense.currency` を持ち、精算を通貨ごとに分ける | ○ 混在が表せる。✗ 帳簿が2本になる。✗ 表・計算・UI・テストがすべて2倍で、MVP に対して重い |
| 案C: 換算して1本にまとめる | レートを取って合算 | ✗ **却下**。値洗い（いつの時点の換算か）と差損の説明責任がアプリ側に生まれる（§3.1-4） |

- 金額は**整数の円**。入力上限は 1〜10,000,000（`WARIKAN_AMOUNT_MAX`。打ち間違いを弾くため）
- 表示は shared の1関数 `formatYen(amount: number, locale: "ja" | "en"): string`（ja `1,200円` / en `¥1,200`）
- sat 建ての帳簿が欲しくなったら §6。決めるのは「もう1本の独立した帳簿を作るか」で、換算は永久に持たない

### 3.3 データモデル

マイグレーション `apps/server/migrations/0096_warikan.sql`
（本節の SQL のコメントは本書向けの要約。DDL 本文は migration と同一）:

```sql
-- 割り勘 (#556)。金額は円のみ。
-- このアプリは送金も金銭の預託も換算もしない。支払いの事実も持たない。
-- 持つのは立替の帳簿と受け取り先の掲示だけ（設計 §3.1）
-- event 側にオン/オフの列は持たない（設計 §3.3）
--
-- 帳簿の当事者（payer / share）の user FK には ON DELETE を付けない
-- （= user 行の削除をブロックする）。退会では ghost へ、統合では勝ち側へ
-- 必ず付け替えてから user を消す（設計 §3.3「退会・統合」）。付け替えを
-- 忘れた経路は黙って他人の金額を動かすのではなく、FK 違反で止まる

-- 立替1件（誰が・いくら・何に払ったか）
CREATE TABLE event_expense (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  payer_user_id TEXT NOT NULL REFERENCES user(id),    -- 立て替えた人。入力者とは別
  amount INTEGER NOT NULL,                            -- 円（整数）
  title TEXT NOT NULL,                                -- 「会場費」「打ち上げ」など
  note TEXT NOT NULL DEFAULT '',
  spent_on TEXT,                                      -- 'YYYY-MM-DD'（任意。isDateOnly で検証）
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,  -- 入力した人（表示と編集権に使う）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (amount > 0)
);
CREATE INDEX idx_event_expense_event ON event_expense(event_id, created_at);
CREATE INDEX idx_event_expense_payer ON event_expense(payer_user_id);

-- この立替を誰で割るか。1人1行。weight は整数の重み（等分は全員 1）
CREATE TABLE event_expense_share (
  expense_id TEXT NOT NULL REFERENCES event_expense(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  weight INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (expense_id, user_id),
  CHECK (weight > 0)
);
CREATE INDEX idx_event_expense_share_user ON event_expense_share(user_id);

-- 受け取り先（イベント内・本人のもの）。**受け取るために公開する識別子だけ**（設計 §3.6）。
-- 銀行口座はこの表に入れない。kind の CHECK がその門で、'bank' を足すには
-- テーブル再構築が要る＝「うっかり足す」ができない形にしてある。
-- 自由記述の表示名（label）は持たない（口座番号を書ける欄を作らないため）
CREATE TABLE event_payout_method (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,  -- 受け取る本人。退会で消える
  kind TEXT NOT NULL,                  -- 'url' | 'lightning'
  value TEXT NOT NULL,                 -- https の URL / LN Address・LNURL
  created_at INTEGER NOT NULL,
  CHECK (kind IN ('url', 'lightning'))
);
CREATE INDEX idx_event_payout_method_owner ON event_payout_method(event_id, user_id);
```

表は **3つ**。支払いに関する表は無い（§3.1-7）。

**`event` テーブルに列を足さない（オン/オフの設定を持たない）。**
機能の有無は行の有無で決まる。`updateEventInput` / `eventSchema` / イベント編集画面は変えない。

**列に持たないもの（すべて読むたびに導出する。#431 §3.3 と同じ姿勢）:**
各人の負担額（§3.4）、収支（§3.5）、精算の提案とその内訳（§3.5）。
「精算済みか」は導出もしない（そもそも持たない。§3.1-7）。

**上限**（`packages/shared/src/warikan.ts` の定数）:

| 定数 | 値 | 守り方 |
|---|---|---|
| `WARIKAN_EXPENSE_MAX` | 200 件 / イベント | **1文の条件付き INSERT**（`INSERT … SELECT … WHERE (SELECT COUNT(*) FROM event_expense WHERE event_id=?) < 200`）。変更行 0 なら 409 `too_many_expenses`。数えてから入れる2文にしない（#431 §3.5 と同じ） |
| `WARIKAN_SHARES_MAX` | 500 人 / 立替 | zod |
| `WARIKAN_PAYOUT_MAX` | 5 件 / (イベント, 本人) | zod（PUT は置換なので競合しない） |
| `WARIKAN_AMOUNT_MAX` | 10,000,000 円 | zod |
| `WARIKAN_WEIGHT_MAX` | 100 | zod（入力時のみ。統合で合算された行は超えうる。下記） |
| タイトル / メモ | 100 字 / 500 字 | zod |

`shares` の INSERT は立替の INSERT と**同じ batch** に置き、`WHERE EXISTS (SELECT 1 FROM event_expense WHERE id = ?)`
を付ける（上限で立替が入らなかったときに share だけが入らない。負担者ゼロの立替を作らない）。

#### 退会・統合（ユーザー確定: 退会者の行は ghost 名義で残す）

**不変条件: 誰かの退会・統合で、第三者の負担額と収支は1円も動かない。**

帳簿の当事者の列ごとの扱い:

| 列 | 退会（完全削除 #244/#250） | 統合（`mergeUsers`） | どこに登録するか |
|---|---|---|---|
| `event_expense.payer_user_id` | ghost へ付け替え | 勝ち側へ付け替え | **`SHARED_CONTENT_OWNER_COLUMNS`**（UNIQUE を含まないので単純な UPDATE で足りる。統合と退会の両方がこの配列を回す） |
| `event_expense_share.user_id` | ghost へ付け替え（同じ立替に ghost の行があれば**重みを合算**） | 勝ち側へ（同じく**重みを合算**） | **新設 `LEDGER_PARTY_REASSIGN_SQL`**（下記。PK に user を含むので単純 UPDATE は衝突する） |
| `event_expense.created_by` | FK の SET NULL | `mergeUsers` の `simple` | `simple` のみ |
| `event_payout_method.user_id` | FK の CASCADE で消える（本人の受け取り先は残さない） | `simple` で勝ち側へ（5件を超えても表示は全件。次の PUT で5件以下にしないと保存できない） | `simple` のみ |

`LEDGER_PARTY_REASSIGN_SQL`（`userTables.ts` に新設。SQL の断片の配列。`?1` = 移す元、`?2` = 移す先。
**文の順序が仕様**。統合は `simple` の前、退会は (1) の直後で、どちらも同じ配列を先頭から回す）:

```sql
-- (a) 同じ立替に移す先の負担行があれば、重みを足し込む
UPDATE event_expense_share
   SET weight = weight + (SELECT s.weight FROM event_expense_share s
                           WHERE s.expense_id = event_expense_share.expense_id AND s.user_id = ?1)
 WHERE user_id = ?2
   AND expense_id IN (SELECT expense_id FROM event_expense_share WHERE user_id = ?1);
-- (b) 足し込んだ元の行を消す
DELETE FROM event_expense_share
 WHERE user_id = ?1
   AND expense_id IN (SELECT expense_id FROM event_expense_share WHERE user_id = ?2);
-- (c) 残りを付け替える（もう PK は衝突しない）
UPDATE event_expense_share SET user_id = ?2 WHERE user_id = ?1;
```

扱う表は `event_expense_share` の1つだけ（`payer_user_id` は `SHARED_CONTENT_OWNER_COLUMNS` 側）。

なぜこれで不変条件が守れるか:

- 立替者以外の負担額は `floor(amount × weight_i / Σweight)`（§3.4）。重みを**合算**すれば Σweight は変わらないので、
  **第三者の負担額は変わらない**。動きうるのは合流した行と立替者の間の最大1円だけ（端数は立替者が持つため）。
  旧案の `uniqueKeyed`（負け側を捨てる）は重みが落ちて他人の額が動くので**使わない**
- 付け替えで「自分が自分の立替に乗る」行が生まれても、立替者自身の負担は債務を生まない（§3.5 手順1）ので、
  誰の収支も変わらない。CHECK 違反になる列も無いので、統合前に消しておく行は無い
- ghost は全イベントで1人（`DELETED_USER_DISCORD_ID`）。同じイベントの退会者が複数いると ghost に合流するが、
  第三者から見た収支（net）は変わらない（ghost との精算の行が1本にまとまるだけ）

その他の登録:

- **`ACTIVITY_TABLES`** に `event_expense.payer_user_id` / `event_expense_share.user_id` の **2 列**を追加する。
  イベントから外された後に帳簿の行だけが残った人が、連携の引き取り (#238) で「実績なし」と判定され
  `deleteById` に進むのを止める（FK がブロックする列を見ていないと、そこで落ちる）
- **テストの見張りを広げる**: `test/user-tables.test.ts` の「ブロックする列は deleteAccount が解消している」は、
  いま「`SHARED_CONTENT_OWNER_COLUMNS` にある」か「`DELETE FROM 表` がある」で判定している。
  `LEDGER_PARTY_REASSIGN_SQL` の (b) にも `DELETE FROM` があるので**偶然通ってしまう**。
  第3の解消手段として「`LEDGER_PARTY_REASSIGN_SQL` が扱う表」を明示的に数え、
  統合と退会の両方がそれを**書き写さずに import している**ことも見張る（既存の SHARED 用テストと同じ型）
- 実数の更新（`EXPECTED_USER_COLUMNS` / `EXPECTED_BLOCKING_COLUMNS` / `EXPECTED_SHARED_CONTENT` / `EXPECTED_ACTIVITY`、
  `merge-user-columns.test.ts` の組数）: 具体的な数字は**実装側で数えて確定する**。本書には書かない。
  旧案（支払いの表あり）から見ると、user 参照列は `from_user_id` / `to_user_id` / `recorded_by` の **3 列ぶん減る**。
  **数字だけ直して素通りしない**
- **退会申請中**（`user.deleted_at` あり・行はまだ本人名義）の人は、帳簿上の表示名を「退会済みユーザー」にする
  （#250「他の利用者から見えなくなる」と、`docs/staff-todo.md` 6.3 の担当者表示と同じ扱い）。
  金額は動かさない。ログインで復帰すれば名前に戻る

### 3.4 端数: **余りは全部、立て替えた人が持つ**（ユーザー確定）

按分（`packages/shared/src/warikan.ts` の純関数 `allocateShares()`。型は §3.8.1）:

```
W        = Σ weight_i（その立替の負担者全員）
立替者以外の負担者 i:  amount_i = floor(amount × weight_i / W)
remainder = amount − Σ floor(amount × weight_j / W)   （全員ぶんの切り捨て合計との差。0 ≦ remainder < 負担者数）
立替者が負担者に居る:  立替者の負担 = floor(amount × weight_p / W) + remainder
立替者が負担者に居ない: 立替者がかぶる額 absorbedByPayer = remainder（立替者は Σ amount_i だけを受け取る）
```

| 例 | 結果 |
|---|---|
| 1,002円 を4人（立替者 A を含む・重み全部1） | B・C・D は 250。**A は 252** |
| 1,000円 を B・C・D（立替者 A は負担者外） | B・C・D は 333。**A が 1円かぶり**、受け取るのは 999 |
| 1,000円 を A(1)・B(2)・C(1)（立替者 A） | B 500・C 250・A 250 |
| 1円 を3人（立替者を含む） | 他の2人は 0、立替者 1（0円の負担者も表示する） |

- 説明文は1文で済み、**常に正しい**: 「**割り切れない端数は、立て替えた人が持ちます。**」
- 順序キーが要らない。**参加登録順（`event_member.created_at`）に依存しない**ので、
  誰かの取消・再参加・除外で過去の配分がさかのぼって変わることが無い（§2.3）
- 立替者以外の額は**自分の重みと Σweight だけ**で決まる。これが §3.3 の不変条件の土台
- 保証（テストで固定）: **Σ(全負担者の負担) + absorbedByPayer = amount**（1円も消えない・増えない）

### 3.5 精算の計算: **立替者への直接返済（ペアごとに相殺）**（採用）

| 案 | 内容 | 評価 |
|---|---|---|
| 案A: 立替者へ直接返す＋ペア相殺（**採用**） | 「この立替に乗った人 → 立て替えた人」を積み上げ、A→B と B→A は**差額に相殺**する | ◎ 行ごとに根拠（内訳）を出せる。◎ 説明が1行。△ 人数×立替が多いと取引数が増える |
| 案B: 貪欲法で取引回数を最小化 | 全員の収支だけを見て、債務者→債権者を大きい順に潰す | ○ 取引数は最小に近い。✗ **自分が一度も乗っていない立替の人へ払え**と言われることがあり、根拠を辿れない |

**採用は案A。** 実際のイベントでは「主催が全部立て替える」形が大半で、その場合は案A の取引数が
そもそも最小（全員 → 主催者の1本ずつ）になる。

計算（`settle()`。型は §3.8.1。**入力は立替だけ**）:

```
1. 立替ごとに allocateShares() → 立替者以外の負担者 i について debt[i][立替者] += amount_i
   （立替者自身の負担と absorbedByPayer は債務を生まない＝自己債務は最初から作らない）
2. 双方向を相殺: d = debt[x][y] − debt[y][x]
   d > 0 なら「x が y に d 円」、d < 0 なら向きを逆に、d = 0 は出さない。
   その行の内訳（breakdown）は、この d を作った立替を符号付きで並べたもの（合計 = d）
3. 収支 net_i = Σ_y ( debt[y][i] − debt[i][y] )。Σ_i net_i = 0
```

**精算の行は常に全額を出す。** 実際に支払いが済んでも、行は減らないし消えない（アプリは支払いを知らない。§3.1-7）。
行が変わるのは立替が追加・編集・削除されたときだけ。

**収支（「全員の収支」の列）の定義はここだけ。2列＋差引:**

| 列 | 定義 |
|---|---|
| 立て替えた `paid` | その人が立替者の立替の `amount` の合計 |
| 負担 `owed` | その人の負担額の合計 ＋ その人が立替者としてかぶった端数（`absorbedByPayer`）の合計 |
| 差引 `net` | `paid − owed`。**正 = 受け取る側、負 = 払う側**（手順3 と必ず一致） |

**検算例（テストにもそのまま入れる）:**

1. A が「会場費」3,000円を立替、A・B・C で割る → 各 1,000。
   **A +2,000 / B −1,000 / C −1,000**。精算: B→A 1,000、C→A 1,000
2. 続けて B が「打ち上げ」600円を立替、A・B・C で割る（各 200）→
   精算: **B→A 800**（内訳: 会場費 +1,000 / 打ち上げ −200）、C→A 1,000、C→B 200。
   収支: A +1,800 / B −600 / C −1,200（Σ = 0）。
   B のカードには「A さんに 800円 支払う」「C さんから 200円 受け取る」の**2行**が出る（差引の「600円」は出さない。§3.9）

- 行の並びは決定的（`fromUserId`, `toUserId` の辞書順）。画面は「あなたの精算」で自分の行だけを出す
- 取引回数を減らす表示（案B）は §6

### 3.6 受け取り先: **URL と Lightning だけを保存する**（ユーザー確定）

#### 3.6.1 当初の要望と、ここで諦めるもの

当初の要望は「**支払先は URL・振込先・Sats などをイベントごとに設定できるようにする**」だった。
そのうち**振込先（銀行口座）は保存しない**と決めたので、**銀行口座については「設定して残しておく」が成り立たない。**
3つのうち1つを、要望どおりには実現しない。

**諦めるもの**: 「主催者が最初に口座を登録しておけば、以後は参加者が画面だけを見て振り込める」という流れ。

| 種別 | 性質 | 漏れたときに起きること |
|---|---|---|
| URL（PayPay / Kyash 等） | **受け取るために相手へ渡す前提の識別子** | 受け取る側の不利益はほぼ無い |
| Lightning（LN Address / LNURL） | 同上。**公開して受け取るための形式** | ほぼ無い |
| **銀行口座（銀行名・支店・口座番号・名義）** | **資金の受け皿そのもの。名義から本名も出る** | 振込先としての悪用・本名の流出。**取り返しがつかない** |

危険なのは**銀行口座だけ**で、そこだけ落とせば懸念は消える。**持たないものは漏れない・消し忘れない**。

#### 3.6.2 銀行振込が必要なときの代替（UI は手段を指定しない）

- 受け取り先が未登録の相手の行には、次の固定文を出す:
  「**受け取り先が登録されていません。振込先は相手から個別に聞いてください。このアプリには書かないでください。**」
- **チャットを口座のやりとりの場として案内しない**（イベントチャットは参加者全員に見えるグループの場で、
  本文はアプリの外のリレーに送られて消しにくい。口座番号をそこへ書かせるのは、D1 に欄を作るより悪い）。
  `chatAvailable`（`useEventChatAccess`）のときだけ「**チャットで声をかける**」という小さなリンクを添えてよいが、
  文言は声かけにとどめ、口座を書く場として示さない
- **正直な但し書き**: 自由記述の欄（イベントの説明文・参加者向けお知らせ・**立替のタイトルとメモ**）に
  本人が口座を書けば、文字列としては D1 に残る。本機能が守るのは「**アプリが口座の専用欄を用意して集めない**」ことで、
  自由記述の検閲はしない。代わりに:
  - 自由記述の欄を**減らした**: 受け取り先の表示名（旧 `label`）は**持たない**（§3.3）。本機能の自由記述は立替のタイトルとメモだけ
  - 立替のメモ欄の補足に「振込先はここに書かないでください」を出し、placeholder は用途の例（「3次会の分」）だけにする。
    **placeholder や例に口座を連想させる語（銀行・口座・振込）を出さない**ことをレビューのチェック項目にする
  - 説明文や membersNote に書く運用は**本書の中の事実として記すだけ**で、UI の文言では勧めない

#### 3.6.3 却下した案

| 案 | 却下理由 |
|---|---|
| 一切保存しない | URL と LN Address まで捨てると、精算の行から実際の支払いへ移る導線が消える。この2つは公開して受け取るための識別子で、伏せる実益が無い。懸念に対して過剰 |
| 本人の端末だけに持つ（localStorage / URL フラグメント） | **端末を変えると消える**・**本人がその場に居ないと出せない**（割り勘は後日やるので致命的）。共有した先のログ・スクリーンショットには結局残る |
| 種別ごとに保存先を変える（URL/LN は DB、口座は端末） | 上の2つの弱点を両方抱え、消し方も2通りになる |

#### 3.6.4 型と表示

DB は `kind` + `value` の**2列**。入力は判別共用体で検証する（§3.8.1 の `payoutMethodInput`）。

- **`bank` は共用体に無いので入力できない。DB の CHECK が二段目の門**。将来 `bank` を足すには
  テーブル再構築が要る（#431 の CHECK とは逆で、ここでは**足しにくさ自体が仕様**）
- 表示名は保存せず、**導出する**: `url` はホスト名（`paypay.ne.jp`）、`lightning` は値そのもの。
  種別の見出しは「受け取り用リンク（PayPay・Kyash など）」「Lightning アドレス」
- 表示（`apps/web`）:
  - `url` → 主ボタン「**リンクを開く**」（新しいタブ・`noopener noreferrer`）。その下にホスト名を小さく出す
    （なりすましのリンクに気づけるように）
  - `lightning` → 主ボタン「**ウォレットで開く**」（`lightning:<value>`）、次に「コピー」、
    「QRを表示」で QR を開く（別の端末で払うとき・対面用）。**sat の額は示さない**。補足に
    「金額の表示は円のみです。送る sat の額はご自身で決めてください。」
  - 精算の行の金額の横に「**金額をコピー**」（向こうのアプリで金額を打つため）。コピーしたら「コピーしました」
- 受け取り先は、**本人が消すまで残る**（イベントはほとんど削除されないので、CASCADE に保護を期待しない）。
  そのため**本人が自分の受け取り先を削除できる口を必ず置く**

#### 3.6.5 公開範囲

**`value` は帳簿を見られる人（§3.7 の門）全員に見せる。** 残った2種は受け取るために公開する識別子で、
隠す実益が無い。債務の有無で出し分けると、立替の編集で行が消えた瞬間にリンクも消える説明しづらい挙動になる。

### 3.7 権限と、参加状態が後から変わった人

#### 3.7.1 門（1つの SQL 断片に閉じる）

**帳簿を見られる人（`warikanAudience`）** = `requireEventAccess`（`canViewEvent`）を通り、かつ次のどちらか:

1. そのイベントの **`status='confirmed'` のメンバー**（role 不問。observer も含む）
2. **帳簿の当事者**（そのイベントの立替の `payer` か負担者のどちらかに居る人）

判定は `eventWarikan.ts`（リポジトリ）の SQL 断片 `LEDGER_AUDIENCE_SQL` の**1か所**に置き、GET と
当事者として行う書き込み（受け取り先）の両方が同じ断片を使う。通らない相手は **404**。

- 2 があるので、**取消・除外・キャンセル待ちに戻った人でも、自分の貸し借りは見られて、払える・受け取り先を出せる**
- 非公開イベントで閲覧資格そのものを失った人（#526）は `requireEventAccess` で 404。
  **イベントが見えない人に帳簿だけ見せる経路は作らない**

#### 3.7.2 誰が何をできるか

「staff」は常に **`isConfirmedEventStaff`**（そのイベントの confirmed staff）。コミュニティ管理者・アプリ管理者は含めない（#275）。

| 操作 | 誰が | `eventWrite` の permission と追加条件 |
|---|---|---|
| 帳簿を見る | `warikanAudience` | —（GET） |
| 立替の追加 | 確定メンバーのうち `role <> 'observer'` | ルートで確認 → `member`。上限は §3.3 の条件付き INSERT |
| 立替の編集・削除（自分が入力したもの） | 入力者本人（いまも確定メンバーである間） | `member` ＋ `WHERE created_by = 本人` |
| 立替の編集・削除（他人のもの） | staff | `staff` |
| 自分の受け取り先の登録・削除 | `warikanAudience` の本人（他人の分は誰も登録できない） | `view` ＋ `LEDGER_AUDIENCE_SQL` |
| 他人の受け取り先の削除 | staff（削除のみ。編集は不可） | `staff` |

- `eventWrite` の先頭の再確認で閲覧権・退会申請中でないこと・（`member`/`staff` なら）確定を同じ batch で見る。
  崩れていたら 409 `access_changed`
- なりすましの受け取り先（偽の PayPay リンクを他人名義で置く）を防ぐため、**登録は中身が口座でなくても本人だけ**
- 精算の行に対する操作は無い（見る・金額をコピーする・受け取り先を開くだけ。§3.1-7）

#### 3.7.3 誰を負担者・立替者に指定できるか

- **新しく指定できる人（`selectable`）** = 確定メンバー かつ `role <> 'observer'` かつ 退会申請中でない
- **PATCH は「新しく加わる人だけ」を検証する**: 置換後の `shares` のうち、**既存の行に無い userId** と、
  **変更後の立替者（変わった場合のみ）** が `selectable` であること。既存の負担者・立替者は、
  取消した人・退会済みユーザーでもそのまま残せる（タイトルを直すだけで誰かを外さざるをえない、を起こさない）
- 対象者の資格はルートで確かめ、batch の中では再検証しない。保存と同時に誰かが取消しても、
  その人は「帳簿の当事者」として扱えるので壊れない（3.7.1 の 2）

#### 3.7.4 参加状態ごとの扱い（まとめ）

| 状態 | 見る | 立替を追加 | 受け取り先 | 新たに指定 | 表示名 |
|---|---|---|---|---|---|
| 確定（participant / staff / judge） | ○ | ○ | ○ | ○ | 名前 |
| 確定（observer） | ○ | ✗ | ○ | ✗ | 名前 |
| 当事者だが今は非確定（canceled / waitlist / applied / lost / 除外済み） | ○ | ✗ | ○ | ✗（既存の行は残る） | 名前 |
| 当事者でなく非確定 | 404 | — | — | — | — |
| 退会申請中 | —（ログインすると復帰するので本人操作は起きない） | — | — | ✗ | 退会済みユーザー |
| 完全削除後（ghost） | — | — | — | ✗ | 退会済みユーザー |

退会済みユーザーとの精算の行は出すが、**受け取り先は出さない**（払う相手が居ない）。
直す必要があれば staff が立替を編集する。

### 3.8 API

すべて `apps/server/src/routes/eventWarikan.ts`（新規）。リポジトリは
`apps/server/src/db/repositories/eventWarikan.ts`（新規。表は3つだが**按分と精算という1つの手続き**を共有するので
1ファイル。`docs/design.md`「データアクセス方針」の「1つのテーブルに収まらない大きな手続き」に該当）。
按分・精算の**計算は shared の純関数**、サーバーはそれを呼ぶだけ（同じ計算を2か所に書かない）。

| メソッド/パス | 誰が | 何をする |
|---|---|---|
| `GET /api/events/:id/warikan` | `warikanAudience` | §3.8.1 の `WarikanLedger` を返す。立替0件でも 200（空の帳簿） |
| `POST /api/events/:id/warikan/expenses` | 確定・observer 以外 | `expenseInput`。201 `{ expense }` |
| `PATCH /api/events/:id/warikan/expenses/:expenseId` | 入力者本人 / staff | `expenseInput`（全項目送り。`shares` ごと置換。§3.7.3 の緩い検証） |
| `DELETE /api/events/:id/warikan/expenses/:expenseId` | 入力者本人 / staff | 削除（`shares` は CASCADE） |
| `PUT /api/events/:id/warikan/payout-methods` | 本人 | `upsertPayoutMethodsInput`。**自分の**受け取り先を置換（他人の userId はパスにも body にも無い） |
| `DELETE /api/events/:id/warikan/payout-methods/:methodId` | 本人 / staff | 削除 |

- 公開（未ログイン）の口・イベント設定を変える口は無い
- 精算の行を変える口は無い（行は立替から導出するだけ。§3.5）
- ポーリングしない（`invalidateQueries` で十分）
- 子リソース（`expenseId` / `methodId`）は `loadXxx()` で `eventId` 一致を確かめ、不一致は 404

#### 3.8.1 型（`packages/shared/src/warikan.ts`。**このとおりに作る**）

```ts
export const PAYOUT_KINDS = ["url", "lightning"] as const;

/* ---------- 入力 ---------- */
const shareInput = z.object({
  userId: z.string().min(1),
  weight: z.number().int().min(1).max(WARIKAN_WEIGHT_MAX),
});
export const expenseInput = z.object({
  payerUserId: z.string().min(1),
  amount: z.number().int().min(1).max(WARIKAN_AMOUNT_MAX),
  title: z.string().trim().min(1).max(100),
  note: z.string().max(500).default(""),
  spentOn: z.string().refine(isDateOnly).nullable().default(null),   // dateOnly.ts の既存関数
  shares: z.array(shareInput).min(1).max(WARIKAN_SHARES_MAX)
    .refine((a) => new Set(a.map((s) => s.userId)).size === a.length, { message: "duplicate_share" }),
});
export const payoutMethodInput = z.discriminatedUnion("kind", [
  // 受け取り用リンク（PayPay / Kyash 等）。https のみ。アプリは開くだけで叩かない（§3.1）
  z.object({ kind: z.literal("url"),
    value: z.string().url().max(500).refine((u) => u.startsWith("https://")) }),
  // LN Address（user@domain）/ LNURL（lnurl1...）。解決も invoice 発行もしない
  z.object({ kind: z.literal("lightning"),
    value: z.string().min(3).max(500).regex(/^([^\s@]+@[^\s@.]+\.[^\s@]+|lnurl1[0-9a-z]+)$/i) }),
]);
export const upsertPayoutMethodsInput = z.object({
  methods: z.array(payoutMethodInput).max(WARIKAN_PAYOUT_MAX),
});

/* ---------- 純関数 ---------- */
export interface CalcShare { userId: string; weight: number }
export interface CalcExpense { id: string; payerUserId: string; amount: number; shares: CalcShare[] }

export interface Allocation {
  /** 入力の shares と同じ順・同じ userId。立替者の行は端数を含む */
  shares: { userId: string; weight: number; amount: number }[];
  /** 全員の切り捨て合計との差（0 ≦ remainder < 負担者数）。表示用 */
  remainder: number;
  /** 立替者が負担者に居ないときにかぶった額（= remainder）。居るときは 0 */
  absorbedByPayer: number;
}
/** §3.4。shares は1件以上・userId 重複なしを前提（入力の zod が保証） */
export function allocateShares(expense: CalcExpense): Allocation;

/** 内訳の1項目。符号付き。正 = from→to の債務を増やす（to の立替に from が乗った）、負 = 減らす（from の立替に to が乗った） */
export interface BreakdownItem { expenseId: string; amount: number }
export interface Settlement {
  fromUserId: string; toUserId: string;
  amount: number;              // > 0
  breakdown: BreakdownItem[];  // Σ amount = Settlement.amount
}
export interface Balance {
  userId: string; paid: number; owed: number;
  net: number;                 // paid − owed。正 = 受け取る側
}
/** §3.5。出力の並び: balances は入力に登場した userId の辞書順、settlements は (from, to) の辞書順 */
export function settle(input: { expenses: CalcExpense[] }): {
  allocations: Record<string, Allocation>;   // key = expense.id
  balances: Balance[];
  settlements: Settlement[];
};

/** 「全員」「出席した人」の初期チェック（§3.9）。selectable な人だけを返す */
export function presetShareUserIds(members: WarikanMember[], preset: "all" | "attended"): string[];
export function formatYen(amount: number, locale: "ja" | "en"): string;

/* ---------- GET の応答 ---------- */
export const warikanMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),      // 退会申請中・ghost は null（UI が「退会済みユーザー」と出す）
  avatarUrl: z.string().nullable(),
  role: z.enum(EVENT_ROLES).nullable(),    // いまのロール。非メンバーは null
  standing: z.enum(["confirmed", "former", "deleted"]),  // §3.7.4 の3分類
  attended: z.boolean(),                   // event_member.attended
  selectable: z.boolean(),                 // §3.7.3
});
export const warikanExpenseSchema = z.object({
  id: z.string(), payerUserId: z.string(), amount: z.number().int(),
  title: z.string(), note: z.string(), spentOn: z.string().nullable(),
  createdBy: z.string().nullable(),        // 「入力: ◯◯」の表示に使う
  createdAt: z.number(), updatedAt: z.number(),
  shares: z.array(z.object({ userId: z.string(), weight: z.number().int(), amount: z.number().int() })),
  remainder: z.number().int(), absorbedByPayer: z.number().int(),
  canEdit: z.boolean(),                    // サーバーが §3.7.2 で判定
});
export const warikanPayoutSchema = z.object({
  id: z.string(), userId: z.string(), kind: z.enum(PAYOUT_KINDS), value: z.string(), canDelete: z.boolean(),
});
export const warikanLedgerSchema = z.object({
  /** 確定メンバー全員 ∪ 帳簿のどこかに登場する全員（入力者・受け取り先の持ち主を含む）。
   * 並びは confirmed → former → deleted、その中は参加登録順（表示のためだけ。計算には使わない） */
  members: z.array(warikanMemberSchema),
  expenses: z.array(warikanExpenseSchema),       // 新しい順
  payoutMethods: z.array(warikanPayoutSchema),
  balances: z.array(/* Balance */ z.object({ userId: z.string(), paid: z.number().int(), owed: z.number().int(),
    net: z.number().int() })),
  settlements: z.array(/* Settlement（内訳つき） */ z.object({ fromUserId: z.string(), toUserId: z.string(),
    amount: z.number().int(),
    breakdown: z.array(z.object({ expenseId: z.string(), amount: z.number().int() })) })),
  me: z.object({ userId: z.string(), canAddExpense: z.boolean(), isStaff: z.boolean() }),
});
export type WarikanLedger = z.infer<typeof warikanLedgerSchema>;
```

内訳は**サーバーが `settle()` の結果として返す**（クライアントで計算し直さない。計算は1か所）。

#### 3.8.2 エラー

| 状況 | status | `error` |
|---|---|---|
| 未ログイン | 401 | 既存の `requireAuth` のまま |
| イベントが見えない・`warikanAudience` 外・子リソースが別イベント | 404 | `not_found` |
| 権限不足（他人の立替を編集など） | 403 | `forbidden` |
| 入力の形（金額範囲・日付・重複 share・受け取り先の種別/件数） | 400 | `validation_error`（既存 `zValidator` の形。`issues[].message` に `duplicate_share`） |
| 新しく指定した負担者・立替者が `selectable` でない | 400 | `invalid_party` |
| 件数上限 | 409 | `too_many_expenses` |
| 書き込み中に資格が変わった | 409 | `access_changed`（`eventWrite`） |

### 3.9 画面

| 画面 | 場所 | 内容 |
|---|---|---|
| 導線 | `components/EventActionButtons.tsx`（参加者向け） | 「割り勘」ボタン（`ReceiptLongIcon`）。表示条件は **`canChat`**（`useEventChatAccess`。確定メンバー）。イベント詳細の応答に `myStatus` は**足さない**（同じ判定がチャット・Q&A・ビンゴで既に使われていて、追加の API も要らない）。`EventActionButtons` の props に `isConfirmed` を足して渡す |
| 割り勘カード | `EventDetailPage` の**見出しブロックの直後（`SchedulePanel` の前）**。`components/WarikanSummaryCard.tsx` | **自分の精算の行があるときだけ**出す。督促通知を作らない以上、ここが自分の貸し借りに気づく唯一の場所なので上に置く。自分の行が無ければ出さない（導線はボタン1つ） |
| 割り勘ページ | `/events/:id/warikan`（`EventWarikanPage`。`EventLayout` の子ルート） | 下の並び |

- カードは `canChat` のときだけ GET を叩く（確定メンバーの詳細表示ごとに1本増える。帳簿は最大 200 件で D1 の数クエリ）
- 当事者だが今は非確定の人には詳細ページの導線は出ない（§6）。URL を知っていれば見られる（§3.7.1）
- **支払いを済ませてもカードは残る**（アプリは支払いを知らない。§3.1-7）。行が消えるのは立替が編集・削除されたときだけ。
  カードを手元で閉じる操作は初回では持たない（§6）

**カードの中身（差引ではなく、やることを行ごとに）:**

| 自分の状態 | 表示 |
|---|---|
| 自分の精算の行がある | 「A さんに 800円 支払う」「C さんから 200円 受け取る」を**最大2行**。3行目以降は「ほか n 件」。下に「割り勘を開く」 |
| 自分の行が無い（帳簿が空／自分は関係ない） | カードを出さない（ボタンから入れる） |

**オン/オフが無いことの意味:** 確定メンバーには常に「割り勘」ボタンが出て、**誰かが最初の1件を登録した時点で割り勘が始まる**。
0件のときに目立つカードは出さない（割り勘をしないイベントの画面を金銭の話で埋めない）。
誤って始まった帳簿は、立替を staff が全部消せば行の無い状態に戻る。

**割り勘ページの並び（上から）:**

1. **免責バナー**（常に表示・閉じられない。ただし1行に畳む）:
   「お金のやりとりは当事者どうしで行います。このアプリはお金を預かりません。」＋「詳しく」で §3.1 の要約を開く
2. **「あなたの精算」** — 自分の行だけ。**行は計算結果の表示で、操作するものではない**。各行に出すのは
   相手・金額・受け取り先・内訳の4つ:
   - 払う側: 「A さんに 800円」＋「金額をコピー」＋相手の受け取り先（§3.6.4）
   - 受け取る側: 「C さんから 200円」。自分の受け取り先が未登録なら「受け取り先を登録する」で下の 5 へページ内リンク
   - 「内訳」を開くと breakdown を名前つきで出す（「会場費 +1,000 / 打ち上げ（あなたの立替）−200 = 800」）
   - 相手の受け取り先が無い → §3.6.2 の固定文。相手が退会済みユーザー → 「退会済みのため精算できません」
   - 自分の行が無い → 「あなたの精算はありません」
   - 見出しの下に1行: 「支払いが済んだかどうかは、このアプリでは管理しません。」
3. **「立替の一覧」** — 立替者・タイトル・金額・負担人数・日付・「**入力: ◯◯**」。行を開くと負担者と配分額
   （立替者の行に「端数 n円を含む」、負担者外なら「端数 n円は立替者が持ちます」）。observer には追加ボタンを出さない
4. **「全員の収支」** — §3.5 の3列（立て替えた・負担・差引）。スマホで横に溢れる対策は §6
5. **「自分の受け取り先」**（見出しの下に「あなたにお金を返す人に表示されます」）— 自分のぶんだけ。
   種別は「受け取り用リンク（PayPay・Kyash など）」「Lightning アドレス」の2つ。
   下に固定文「**銀行口座はこのアプリに保存できません。**」

**立替フォーム**（スマホでは全画面ダイアログ。保存後に「もう1件入力する」）:

1. **金額**（`inputmode="numeric"`、開いたらここにカーソル）
2. **内容**（チップ: 会場費・打ち上げ・備品・交通費。押すとタイトルに入る。自由入力も可）
3. **払った人**（名前で絞り込める選択欄。既定は自分。先頭に「自分」、次に「この帳簿で立替を入れたことがある人」）
4. **割る人** — プリセットのボタンは**初期チェックを決めるだけ**で、その後いつでも個別に外せる/足せる:
   - 「全員」= `selectable` な全員
   - 「出席した人」= `selectable` のうち、participant で `attended` の人 ＋ staff・judge（出席チェックの対象外になりがちな運営を落とさない）。
     `attendanceCheck` がオンのイベントでだけ出す
   - 下に「n 人・1人あたり約 ◯円」をその場で出す
5. **詳細**（畳む）: 日付（既定はイベント開始日の JST。未定なら空）、メモ（補足「振込先はここに書かないでください」）、重み（人ごとに整数。既定 1）。
   重みの補足: 「**アカウントの無い同伴者の分は、連れてきた人の重みを 2 にしてください。**」

- **編集で開いたときはプリセットを選んだ状態にしない**（保存されているのは負担者の明示リストだけ。チェック済みの一覧で開く）
- アイコンは `@mui/icons-material` の単色 SVG（`ReceiptLongIcon` / `BoltOutlinedIcon` / `LinkOutlinedIcon` / `ContentCopyIcon`）。
  **絵文字は使わない**（`DESIGN.md`）。金額の正負は色ではなく**語**（「支払う」「受け取る」）で表す

### 3.10 i18n・文言

- `packages/shared/src/i18n/messages/warikan.ts`（**新規 namespace。ja/en**）に全部置く（staff 専用画面が無いので `staffOps/` に分けない）
- 入れる文言: §3.9 に書いた固定文すべて、端数の説明1文（「割り切れない端数は、立て替えた人が持ちます。」）、
  重みの補足（同伴者は重み 2）、「支払いが済んだかどうかは、このアプリでは管理しません。」、§3.8.2 のエラーごとの案内

**禁止語（UI 文言・placeholder・コードコメントの UI 由来の語。ここが唯一の一覧）:**

> 決済・入金・送金・請求・集金・未払い・残高・返金・預り・エスクロー・代行・レート

- 「精算」は見出し（「あなたの精算」）には使ってよい。**ボタンに「精算する」を置かない**（押して起きることが無い。§3.1-7）
- 「支払う」「受け取る」は精算の行で**これからやること**を示す語として使う。**「支払済み」「未精算」など状態を表す語は UI に出さない**
  （状態を持っていないため。見出しの「あなたの精算」は状態ではなく一覧の名前）
- コードのコメントでも「決済リンク」と書かず「受け取り用リンク」と書く（UI に漏れやすいため）
- `apps/server/test/warikan.test.ts` で **`warikan.ts` の ja/en の全文字列に禁止語が含まれないこと**を走査して固定する

---

## 4. 変更ファイルと PR の分け方

### 4.1 変更ファイル一覧

| 層 | ファイル | 変更 |
|---|---|---|
| shared | `packages/shared/src/warikan.ts` / `index.ts` | 新規。§3.8.1 の定数・入力・応答スキーマ・純関数 |
| i18n | `packages/shared/src/i18n/messages/warikan.ts` + 登録 | ja/en |
| DB | `apps/server/migrations/0096_warikan.sql` | 新規。3表（`event` への列追加は無し） |
| server | `src/db/repositories/userTables.ts` | `SHARED_CONTENT_OWNER_COLUMNS` +payer、`ACTIVITY_TABLES` +2、**`LEDGER_PARTY_REASSIGN_SQL` 新設**（`event_expense_share` の (a)(b)(c)） |
| server | `src/db/repositories/accountMerge.ts` | `simple` の前に `LEDGER_PARTY_REASSIGN_SQL`、`simple` に `event_expense.created_by` / `event_payout_method.user_id` |
| server | `src/db/repositories/accountDeletion.ts` | (1) の直後に `LEDGER_PARTY_REASSIGN_SQL`（ghost 宛て） |
| server | `src/db/repositories/eventWarikan.ts` | 新規。3表の CRUD、`LEDGER_AUDIENCE_SQL`、帳簿の組み立て（計算は shared） |
| server | `src/routes/eventWarikan.ts` / `src/worker.ts` | 新規ルート（§3.8。6本）と登録 |
| web | `pages/EventWarikanPage.tsx` / `components/WarikanSummaryCard.tsx` / `WarikanExpenseForm.tsx` / `WarikanPayoutMethods.tsx` / `WarikanSettlementRow.tsx` | 新規 |
| web | `api/warikanHooks.ts` | 新規（GET・立替の POST/PATCH/DELETE・受け取り先の PUT/DELETE） |
| web | `pages/EventDetailPage.tsx` / `components/EventActionButtons.tsx` / `App.tsx` | カード・導線（`isConfirmed`）・ルート |
| test | `apps/server/test/warikan-split.test.ts` | 新規。純関数（§5.1） |
| test | `apps/server/test/warikan.test.ts` | 新規。API・権限・退会/統合（§5.2） |
| test | `apps/server/test/user-tables.test.ts` / `merge-user-columns.test.ts` | 実数更新＋第3の解消手段の見張り（§3.3） |

**触らないもの**: `schema.ts`（`eventSchema` / `updateEventInput`）、`notifications.ts`、`events.ts`、
`eventsPublic.ts`（`myStatus` は足さない）、`EditEventPage.tsx`、`eventDuplicate.ts`（複製は §6）。

**純関数のテストの置き場所**: `apps/server/test/warikan-split.test.ts`。
shared には test スクリプトも vitest も無く（`packages/shared/package.json`）、ルートの `pnpm test` は server と web だけを回す。
web の `apps/web/src/lib/*.test.ts` も shared を import しているが、**定数と型だけ**で、shared の関数そのものを
試している先例は server の `test/chat-text.test.ts`（`splitByUrls`）にある。計算を実際に呼ぶのも server なので、こちらに置く。
shared に vitest を足すのは別の論点なので本件ではやらない。

### 4.2 PR の分け方（3本・順に依存）

| # | 範囲 | 依存 | 完了条件 |
|---|---|---|---|
| PR1 | **shared の型と純関数**: `warikan.ts`（§3.8.1 全部。`settle()` の入力は立替だけ）＋ `index.ts` ＋ `apps/server/test/warikan-split.test.ts` | なし | §5.1 が通る。DB・ルートには触れない |
| PR2 | **server 一式**: migration 0096（3表）、`userTables.ts` / `accountMerge.ts` / `accountDeletion.ts` の登録、`eventWarikan.ts`（repo・route。§3.8 の6本）、`worker.ts`、`warikan.test.ts`、`user-tables` / `merge-user-columns` の更新 | PR1 | §5.2 と既存の全 server テストが通る |
| PR3 | **web と文言**: `i18n/messages/warikan.ts`、ページ・カード・フォーム・受け取り先・精算行・hooks、導線 | PR2 | 画面の受け入れ条件（§5.3）。web テスト |

**migration を PR1 に入れない理由**: 帳簿の当事者列は user の削除をブロックする FK なので、migration を入れた瞬間に
`user-tables.test.ts`（「ブロックする列は deleteAccount が解消している」「hasActivity が見ている」）が落ちる。
migration と `userTables.ts` の登録は**同じ PR でないと main が赤くなる**ので、PR2 にまとめる。

---

## 5. テスト観点

### 5.1 純関数（`warikan-split.test.ts`）

- 端数: 1,002円/4人（立替者含む）→ 250・250・250・**立替者 252**。1,000円を立替者以外の3人 → 333×3、`absorbedByPayer = 1`
- 重み 1:2:1 の 1,000円 → B 500・C 250・立替者 250。1円/3人 → 0・0・立替者 1
- **不変条件を多数の乱数入力で確かめる**: Σ負担 + absorbedByPayer = amount、立替者以外の額 = floor(amount×w/W)
- **§3.5 の検算例 1〜2 をそのまま**（収支・精算・内訳の合計）
- 相殺: A の立替で B→A 500、B の立替で A→B 300 → B→A 200 の1本（内訳 +500 / −300）
- Σ net = 0、`net` と `paid − owed` が一致
- 並びが決定的（同じ入力を並べ替えても同じ出力）
- `presetShareUserIds("attended")` が staff・judge を含み、observer・非確定を含まない

### 5.2 サーバー（`warikan.test.ts`）

- 門: 非メンバー・当事者でない applied / waitlist → 404。**当事者だが取消した人 → 200 で自分の行が見える・受け取り先を置ける**
- 権限: 他人が入力した立替の PATCH → 403、**confirmed staff は 200、コミュニティ管理者（非メンバー）は 404/403**。
  入力者本人が取消した後は自分の立替を編集できない
- PATCH の緩い検証: 取消した既存の負担者を含んだまま、タイトルだけ直せる。**新しく**非確定の人を足すと 400 `invalid_party`
- 受け取り先: `kind: "bank"` → 400。repo から `kind='bank'` を直接入れると CHECK が拒む。他人の userId を差せない。value が全員に返る
- 上限: 200 件目まで入り 201 件目が 409。**並行 2 本でも 200 を超えない**（条件付き INSERT）。上限で弾かれたとき share も入らない
- 子リソース: 別イベントの id → 404。`eventWrite` の途中で取消 → 409 `access_changed`
- 応答に支払いの状態に当たるフィールドが無い（`warikanLedgerSchema` の strict parse で固定）
- **統合**: 同じ立替に両アカウントの負担 → **重みが合算**され、第三者の額が変わらない。負け側が立替者の立替は勝ち側名義になる
- **退会（完全削除）**: 負担者・立替者がそれぞれ ghost になり、**第三者の負担額と net が変わらない**。
  同じ立替に退会者が2人 → ghost の行に重みが合算される。受け取り先は消える
- 退会申請中の人は `displayName: null`（表示名が返らない）。`hasActivity` が帳簿の当事者を実績として数える
- 禁止語: `warikan.ts` の ja/en 全文に §3.10 の語が無い

### 5.3 画面（PR3 の受け入れ条件。web テストまたは curl で確かめられる範囲）

- 未確定メンバー（`myRole` はあるが `canChat` が false）に「割り勘」ボタンが出ない
- カードは自分の精算の行があるときだけ、`SchedulePanel` より前に出る。差引ではなく相手ごとの行（最大2行＋「ほか n 件」）
- 精算の行に押せるものは「金額をコピー」と受け取り先のボタン（リンク・ウォレット・コピー・QR）だけ。行の状態を変えるボタンが無い
- observer に「立替を追加」が出ない
- プリセットを押した後に個別に外せる。編集で開くとプリセット未選択でチェック一覧が出る
- 受け取り先の欄に表示名の入力が無い。「銀行口座はこのアプリに保存できません」が出る

---

## 6. やらないこと（初回リリースの範囲外）

**恒久的にやらない**（§3.1 による）:

- 銀行口座の登録欄／受け取り先を端末ローカルに持つ仕組み（§3.6）
- レートによる換算（§3.1-4）
- 参加費の請求・未払い者の扱い（§3.1-8）
- Lightning の invoice 発行 / LNURL の解決 / ウォレット連携（§3.1-3）
- **未精算者への通知・督促・自動リマインド**（§3.1-9）。主催者はイベントチャット (#199) か一斉連絡 (#172) で自分の言葉で呼びかける

**後続でよい**（理由つき）:

- **支払い・受け取りの記録（済みの管理）**（ユーザー確定）。決済は PayPay・銀行・Lightning ウォレットの側で行われ、
  ここに「支払った／受け取った」を持つと、アプリが支払いを扱っているように見える面が残る（§3.1-7）。実装も重い
  （表 1・API 2・権限行 3・退会/統合の付け替え 2 列・虚偽の記録を誰が消せるかの規則）。回収状況は各自が外で管理する。
  将来入れるなら「済みチェック」では足りず、**金額つきの記録**（誰が誰にいくら・双方が消せる・統合時に自分→自分になる行を先に消す、
  という旧 §3.3 の設計）を丸ごと持ち直すことになる。そのときは本書の §3.1-7 を書き換えてから
- **カードを手元で閉じる**（端末ローカルの既読）。支払いを済ませてもカードが残る（§3.9）ことへの手当て。
  サーバーに状態を持たない範囲でできるが、初回では持たない
- **アカウントの無い人（同伴者・飛び入り）を負担者に入れる**（ユーザー確定）。名前だけのメンバーを持つと、
  門・退会・統合・表示のすべてに「user ではない当事者」が入り込む。当面の代替はフォームの補足「連れてきた人の重みを 2 に」（§3.9）
- **sat 建ての帳簿**（§3.2 案B）。足すなら独立した2本目の帳簿として
- **取引回数を最小化する表示**（§3.5 案B）。内訳が出せるいまの方式を既定のまま、追加表示として
- **複製で受け取り先を引き継ぐ**。複製できるのは staff だけ（`eventDuplicate.ts` は `requireEventRole(["staff"])`）で、一般参加者の利益にならない。当初案から外した
- **当事者だが今は非確定の人への導線**（詳細ページやマイページからの入口）。いまは URL を知っていれば見られるだけ
- **スマホでの表の見せ方**（「全員の収支」「立替の一覧」を1件2行のカードに。UX L1）
- **「出席した人」の人数表示**（「出席チェック済みの 12人」。UX L2）と、登録後に出席が付いた人の扱い
- **未ログインでリンクから来た人のログイン後の戻り先**（UX L5。既存の挙動を未確認）
- **LNURL の QR を大文字化して小さくする**・`lightning:user@domain` 非対応ウォレットへの配慮（設計 L3。推測）
- レシート画像・CSV エクスポート・立替の編集履歴・イベントをまたぐ持ち越し
- プロフィールへの受け取り先の保存

---

## 7. Walica との差（何が強化なのか）

Walica 側の記述は**確認していないもの**を含む（SPA で、`curl` では中身を取れなかった。UX レビューより）。
未確認の欄は「未確認」と書き、推測で優劣を付けない。

| できること | Walica | events lab（本設計） |
|---|---|---|
| メンバーの用意 | 手入力 | ◎ **参加者名簿から**。表記ゆれ・取り違えが無い |
| 出席者で割る | 手で選ぶ | ◎ **出席チェックの結果から初期チェック**、その後で個別に外せる |
| 精算の根拠 | 未確認 | ◎ 行ごとに**内訳**（どの立替からこの額になったか） |
| 帳簿へのアクセス | URL を知っていれば見られる（未確認） | ◎ **確定メンバーと当事者だけ** |
| 受け取り先の扱い | 未確認 | ◎ **銀行口座を保存する欄が存在しない** |
| Lightning の受け取り先 | 無し（未確認） | ◎ LN Address / LNURL を「ウォレットで開く」＋QR（**金額は円のみ**） |
| 他人の入力の修正 | 誰でも直せる（未確認） | △ 入力者と staff だけ。「入力: ◯◯」で誰に頼めばよいかは分かる |
| **回収状況の管理（誰が払い終えたか）** | 未確認 | ✗ **持たない**。アプリの外（PayPay・銀行・ウォレットの履歴）で各自が管理する（§3.1-7 / §6）。ここは計算機に徹する判断で、**張り合わない** |
| **アカウントの無い人（同伴者・飛び入り）を割る対象に入れる** | できる（未確認） | ✗ **できない**（§6）。代替は「連れてきた人の重みを 2 に」。**ここは負けている** |
| 匿名で使える | できる | ✗ **できない**（アカウントとイベント参加が要る）。**張り合わない** |
| 未精算の人への声かけ | URL の再送 | △ アプリからは送らない（§3.1-9）。既存のチャット・一斉連絡で主催が行う |

**線の引き方**: 「アカウントが無い人も含めた割り勘」は Walica の領分として**取りに行かない**。
本機能は「**events lab で開いたイベントの、参加者どうしの精算の計算**」に閉じる。支払いそのものと、
その進み具合の管理は、アプリの外にある。
同伴者・飛び入りが多い会では Walica のほうが向いている、と正直に言える形にしておく。

---

## 8. 決定と、残っている判断

### 8.1 決定（すべてユーザー判断済み。本文に反映済み）

1. **通貨は円のみ。** `currency` 列も換算も持たない。Lightning は受け取り先の種別としてだけ残す（§3.2）
2. **オン/オフの設定を持たない。** 確定メンバーなら誰でも最初の1件を登録できる（§3.3 / §3.9）
3. **立替の登録は確定メンバー全員**（observer 除く）。**編集・削除は入力者本人と staff**（§3.7）
4. **未精算者への通知は入れない**（§3.1-9 / §6）
5. **端数は全部、立て替えた人が持つ。** 立替者が負担者外でも、受け取る額を減らしてかぶる（§3.4）。
   参加登録順の順序キーは不要になった
6. **銀行口座は保存しない。** 受け取り先は URL と Lightning だけ。当初要望の「振込先を設定して残す」は実現しない（§3.6）
7. **退会者の行は「退会済みユーザー」(ghost) 名義で残す。** 負担者・立替者とも。
   第三者の金額は動かない（§3.3）
8. **アカウントの無い人は初回では扱わない。** 代替は重み 2 の案内。Walica に負けている点として §7 に載せた（§6）
9. **支払った／受け取ったの状態を持たない。計算機に徹する。** 決済は別のアプリで行われ、回収状況は各自が外で管理する。
   旧案の支払いの表・API・画面はすべて落とした（§3.1-7 / §3.5 / §6 / §7）

### 8.2 レビューを受けて設計側で決めたこと（ユーザー確認は不要と判断。異論があれば差し戻し）

- 閲覧の門を「確定メンバー **または** 帳簿の当事者」に広げた（取消した人も自分の貸し借りを払える。§3.7.1）
- PATCH は新しく加わる人だけを検証する（§3.7.3）
- 「staff」は `isConfirmedEventStaff`、書き込みは `eventWrite`（§3.7.2）
- 帳簿の当事者列の FK は ON DELETE なし（付け替え漏れを FK 違反で止める。§3.3）
- 受け取り先の表示名（`label`）を持たない（口座を書ける欄を減らす。§3.6.2）
- 導線は既存の `canChat` を使い、`myStatus` は足さない（§3.9）
- 複製での受け取り先の引き継ぎは後続へ（§6）
- 支払いを済ませてもカードと精算の行が残る挙動は、状態を持たない決定の帰結として受け入れる。手当ては §6（手元で閉じる）

### 8.3 まだ残っている判断

**なし。** §4.2 の PR1 から実装の分解に進める。ここから外れる判断が要るものが出てきたら、
**実装を止めて本書に追記してから進める**（設計を口頭で更新しない）。
