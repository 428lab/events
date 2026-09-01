# 開催前アンケート (#444)

- 対象: `apps/server`（D1 スキーマ・新ルート・新リポジトリ）、`packages/shared`（型・入力・文言）、
  `apps/web`（回答ページ・主催者の管理ページ・導線）
- ステータス: **設計のみ**（実装はこの設計のレビュー後）
- ユーザー決定事項:
  - **下書きイベント**の主催者がアンケートを作り、**共有URL（推測不能トークン）を
    知っている人**が回答する。イベント本体は下書きのまま見せない
  - 質問は**選択式（単一/複数）と自由記述**。主催者が自由に作る

---

## 1. なぜ作るか

イベントを公開する前に「何曜日がいいか」「どんな内容に興味があるか」を聞きたい。
いまは下書きイベントは本人と招いた運営にしか見えず、外の人に何かを聞く手段が無い。
外部のフォームサービスに逃げると、回答と後のイベントが繋がらない。

## 2. 調査結果（乗る土台と、乗らない判断）

### 2.1 既存の参加アンケート (#152 `event_survey_*`) には乗らない

| 観点 | 参加アンケート (#152) | 開催前アンケート (#444) |
|------|----------------------|------------------------|
| 回答者 | **ログイン済みの参加登録者**（`user_id NOT NULL`・UNIQUE(question, user)） | トークンURLを知っている人（未ログイン含む。§3.3） |
| 入口の門 | イベントが見える人（公開 or メンバー） | **トークンそのもの**（イベントは見せない） |
| アンケート単位のメタ | 無い（質問が直接イベントにぶら下がる） | タイトル・説明・トークン・open/closed が要る |
| 回答の性質 | 1人1回・上書き編集可 | 送信1回きり・匿名あり（§3.4） |

相乗りするには `event_survey_answer.user_id` を NULL 可に変え（#152 の「1人1回」の
UNIQUE が壊れる）、`canViewSurvey` の門にトークン経路を割り込ませ、質問表に
survey メタを足すことになる。**アクセスモデルが根本から違うものを1つの表に畳むと、
どの行がどちらの契約かを全読者が毎回判定する羽目になる**ので、表と経路は新設する。

**共用するのは「質問の形」だけ**: `SURVEY_QTYPES`（text/select/checkbox）・
選択肢の形（JSON array・20個上限）・質問の入力検証（200字・20問）は
`packages/shared/src/eventSurvey.ts` の既存部品を import して使う（契約は1か所。
単一選択=select / 複数選択=checkbox / 自由記述=text がそのまま要件に一致する）。

- 名前の紛らわしさに注意: #152 の `phase='pre'` は「参加登録時」の意味。UI 文言は
  #152 が「参加アンケート」、本機能が「開催前アンケート」で区別する（既存文言は変えない）
- Q&A（`event_qa` / `event_question`）は参加者からの質問投稿で方向が逆。無関係

### 2.2 トークンURLの先例

| 先例 | 形 | 本件への適否 |
|------|----|-------------|
| `/e/:slug`（短縮URL） | 8桁hex・公開イベント用 | 短すぎて総当たりに弱い（公開物なので許されている）。**不可** |
| `mt1.`/`evt1.`（署名トークン） | 署名付き・短寿命 | 失効＝時間切れのみで**再発行（旧URL無効化）ができない**。不可 |
| staff 招待 (#339) | user 指名型（URLでない） | モデルが違う |

→ **保存型のランダムトークンを新設**する: `crypto.getRandomValues` の 128bit を
32桁hexで（`/s/:token`）。DB の UNIQUE 列に保存し、**再発行＝列を書き換える**ことで
旧URLは即座に 404 になる。推測不能性は 128bit 乱数が担い、門はトークン一致の1つだけ。

## 3. 設計

### 3.1 スキーマ

`apps/server/migrations/0083_pre_event_survey.sql`:

```sql
-- 開催前アンケート (#444)。下書きイベントの主催者が作り、トークンURLで配る。
-- イベント本体は見せない（回答者に返るのはこの表と質問の内容だけ。§3.2）
CREATE TABLE event_pre_survey (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES event(id) ON DELETE CASCADE, -- 1イベント1件
  token TEXT NOT NULL UNIQUE,       -- 128bit 乱数(32hex)。再発行で置換＝旧URL即無効
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE event_pre_survey_question (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES event_pre_survey(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  qtype TEXT NOT NULL DEFAULT 'text',   -- SURVEY_QTYPES（#152 と同じ enum を共用）
  options TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_pre_survey_q ON event_pre_survey_question(survey_id, sort_order);

-- 回答1件＝1人の送信（未ログインは user_id NULL）
CREATE TABLE event_pre_survey_response (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES event_pre_survey(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,  -- 退会でも集計を痩せさせない
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_pre_survey_r ON event_pre_survey_response(survey_id, created_at);

CREATE TABLE event_pre_survey_answer (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES event_pre_survey_response(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES event_pre_survey_question(id) ON DELETE CASCADE,
  value TEXT NOT NULL DEFAULT ''        -- checkbox は JSON array 文字列（#152 と同じ形）
);
CREATE INDEX idx_pre_survey_a ON event_pre_survey_answer(response_id);
```

- **1イベント1件**（UNIQUE event_id）。複数アンケートは要件に無く、増やすのは
  「アンケート一覧の管理」という別の複雑さを持ち込む。要るときに UNIQUE を
  外す方向の変更は安い（§6）
- `user_id` は **SET NULL**（退会しても回答は匿名回答として残る＝集計が痩せない。
  #441 の redeemed_by と同じ判断）。mergeUsers は UNIQUE が無いので
  **`simple` に `["event_pre_survey_response", "user_id"]`** を追加し、
  `merge-user-columns.test.ts` の実数を +1/+1 更新
- イベント削除は CASCADE で全部消える（既存の姿勢どおり）

### 3.2 下書き情報の漏れ防止（最大の急所）

**回答者向けの応答に載せてよいのは「主催者がこのアンケートのために書いたもの」だけ**:

```
GET /api/public/pre-surveys/:token →
  open:   { status: "open", title, description, questions: [...] }
  closed: { status: "closed", title }           ← 質問すら返さない
  不明トークン・アンケート未作成: { error: "not_found" }, 404
```

- **`eventId`・イベントのタイトル・日時・会場・主催者名は一切載せない**（サーバー側の
  責務。クライアントで伏せるのは偽の防御）。イベント名を伝えたい主催者は、アンケートの
  タイトルや説明に**自分で書く**（＝明示的な選択）
- 管理ページに「このURLを知っている人は誰でも回答できます。イベント本体の情報は
  一切表示されません」の説明を置き、**URLの再発行**ボタンを付ける（配布先を間違えた・
  想定外に拡散したときの取り消し手段。再発行で旧URLは即 404）
- 回答ページは通常の `Layout` に載せてよい（サイト自体は公開物。漏れの対象は
  下書きイベントの情報であって、サイトの存在ではない）
- 質問の文言そのものは主催者の責任範囲（そこに秘密を書けば見えるのは当然）

**経路の全数**: トークンで出るのは公開 GET と回答 POST の2本だけ。staff 向け
（質問編集・結果・再発行・クローズ）はすべて `/events/:id/pre-survey` 配下で
`requireEventRole(["staff"])`。下書きイベントの staff 判定は既存の門がそのまま効く。

### 3.3 回答のログイン要否: **未ログイン可（推奨・採用）**

| 案 | 内容 | 評価 |
|----|------|------|
| 案A: 未ログイン回答可（**推奨**） | トークンURLだけで回答できる。ログイン済みなら `user_id` を記録 | 開催前の告知は SNS・DM で「アカウントの無い層」に配るのが主目的。ログインの壁は回答率を直撃する。重複・荒らしは**担保しないと割り切り**、対策はトークン再発行＋手動クローズ＋回答数上限（下記） |
| 案B: ログイン必須 | UNIQUE(survey, user) で1人1回が構造的に守れる | 「まずアカウントを作って」は開催前アンケートの用途と噛み合わない。1人1回が本当に要る調査（投票など）は本機能の守備範囲外 |

案A の割り切りを明文化する:

- **1人1回は担保しない**（同じ人が2回送れる）。開催前の関心調査は傾向が分かれば
  足りるという前提。管理ページにもその旨を書く（「厳密な投票には使えません」）
- 荒らし耐性は3段: (1) 128bit トークン（無差別砲撃が届かない）
  (2) **回答数上限 1000 件/アンケート**（超過は 409 `survey_full`。溢れさせる荒らしの
  打ち止め） (3) 気付いたら**再発行 or クローズ**（配布済みURLごと無効化）
- **記名は回答者の選択だけで決まる (#448)**: 回答は既定で匿名。ログイン中の回答者に
  「アカウントで回答する（表示名が主催者に伝わります）」の同意チェック（既定オフ）を
  出し、**チェックした送信だけ `user_id` を保存**する。同意が無ければログイン中でも
  保存しない（見せないだけでなく**持たない**）。主催者側の設定は作らない
  （設定の口を増やさない。記名を必須にしたい主催者は説明文でお願いする）
- 結果画面の内訳は「記名 n件」。一覧 (#447) の回答者列は記名回答だけ表示名、
  それ以外は「匿名」

### 3.4 回答の契約: 送信1回きり・編集なし

- 未ログイン回答は本人を特定できないので、編集はそもそも成立しない。ログイン済み
  だけ編集可にすると「編集できる回答とできない回答」の2契約になるため、
  **全員一律で送信1回きり**にする。送信後は完了画面（回答内容の控えを表示）
- 入力検証は #152 の部品を共用: required 検査・select は options 内・checkbox は
  options の部分集合・自由記述 2000 字
- 質問の編集（staff）は #152 と同じ型（id 一致の一括保存で回答を保持、削除された
  質問の回答は CASCADE で消える）。回答が付いた後の選択肢変更は集計を歪めうるが、
  #152 が既に同じ割り切りで運用されている——同じ姿勢に揃え、編集UIに注意書きを出す

### 3.5 締め切りと公開後の扱い

- **手動クローズのみ**（`status='closed'`・再オープン可）。締切日時の自動クローズは
  作らない（時刻の門が1つ増える割に、手で閉じれば足りる）
- **イベント公開後も自動では締めない・消さない**。配布済みのURLの先にいる人へ
  「公開したので回答は締め切りました」を機械が勝手に言うべきではない。役目が
  終わったら staff がクローズする。公開後の管理ページに
  「イベントは公開済みです。役目を終えたら締め切りましょう」の案内だけ出す
- クローズ後も**結果は staff がいつでも見られる**（回答は消えない）

### 3.6 API

| メソッド/パス | 誰が | 内容 |
|---|---|---|
| `GET /api/public/pre-surveys/:token` | 誰でも（トークンが門） | §3.2 の形。`worker.ts` に直接登録（`/api/public` 配下の既存の型） |
| `POST /api/public/pre-surveys/:token/responses` | 誰でも | 回答送信。`named`（回答者の同意 #448）とログインが揃うときだけ user_id を保存。closed 409 / 上限 409 `survey_full` / 検証 400 |
| `GET /api/events/:id/pre-survey` | staff | 設定・質問・トークン・回答数（管理ページ用） |
| `PUT /api/events/:id/pre-survey` | staff | 作成/更新（title・description・questions 一括。#152 の保存の型） |
| `POST /api/events/:id/pre-survey/rotate` | staff | トークン再発行（旧URL即無効） |
| `POST /api/events/:id/pre-survey/close` / `reopen` | staff | 手動クローズ/再オープン |
| `GET /api/events/:id/pre-survey/results` | staff | 集計: 選択式は選択肢ごとの件数と割合、自由記述は新しい順の一覧。回答総数・記名の件数 |
| `GET /api/events/:id/pre-survey/responses` | staff | 回答一覧 (#447): 行=1送信・新しい順。記名回答は表示名・匿名は null。表ビューと CSV の元データ |
| `DELETE /api/events/:id/pre-survey` | staff | アンケートごと削除（回答も CASCADE。確認ダイアログ必須） |

- 集計は**読むたびに answer 行から計算**する（集計列を持たない。導出の写しを作らない）
- 回答 POST はトランザクション不要の2段（response 行 → answer 行 batch）。
  途中失敗は response ごと消して投げ直す（孤児を残さない #423 の型）。
  上限チェックは「response 挿入を `WHERE (SELECT COUNT(*) ...) < 1000` の1文」で
  原子的に行う（在庫確保 #431 と同じ型。同時送信で 1000 を超えない）

### 3.7 画面

| 画面 | 場所 | 内容 |
|------|------|------|
| 回答ページ | `/s/:token`（新規 `PreSurveyPage`。`/e/:slug` と同じ最上位ルート・未ログイン可） | タイトル・説明・質問フォーム・送信→完了画面。closed は「締め切りました」のみ |
| 管理ページ | `/events/:id/pre-survey`（staff。EventLayout 子ルート・`EventTodoPage` の型） | 質問編集（#152 の編集UIの部品を流用できるか実装時に判断）・共有URLのコピー・再発行・クローズ/再オープン・結果（件数バー＋自由記述一覧）・削除 |
| 導線 | `EventDetailPage` の staff ボタン群 | 「開催前アンケート」（下書き・公開を問わず staff に表示） |

### 3.8 i18n ほか

- 文言: 回答ページは新規 namespace `preSurvey`（回答者向け・ja/en）、管理は
  `staffOps.ts`。「イベント本体の情報は表示されません」等の説明は振る舞いで書く
- 複製 (#duplicate): **コピーしない**。トークン・回答は完全にその回のもの。質問だけ
  コピーする価値はあるが、複製先で誤って同じURLを配る事故の芽と引き換えにしない（§6）

## 4. 変更ファイル一覧（実装フェーズの計画）

| 層 | ファイル | 変更 |
|----|---------|------|
| DB | `migrations/0083_pre_event_survey.sql` | 新規（§3.1） |
| shared | `packages/shared/src/preSurvey.ts` | 型・入力（質問部品は eventSurvey.ts から import）・上限定数 |
| server | `db/repositories/eventPreSurvey.ts` / `routes/eventPreSurvey.ts` | 新規。§3.6 の8本 |
| server | `worker.ts` | 公開2本 + staff ルート登録 |
| server | `db/repositories/users.ts` + `test/merge-user-columns.test.ts` | simple +1・実数更新 |
| web | `pages/PreSurveyPage.tsx` / `pages/EventPreSurveyAdminPage.tsx` | 新規 |
| web | `App.tsx` / `EventDetailPage.tsx` | ルート・導線 |
| i18n | `preSurvey.ts`（新規）/ `staffOps.ts` | ja/en |

## 5. テスト観点（server）

- **漏れ防止**: 公開応答に eventId・イベントタイトル等が**含まれない**こと
  （本文の文字列走査で固定）。不明トークン 404（存在しないのと同一ボディ）。
  **再発行で旧トークンが即 404・新トークンで回答できる**
- 未ログイン回答が通り user_id NULL で入る / ログイン済みは user_id が入る /
  同じ人の2回目も通る（担保しない割り切りの明文化）
- closed: GET が質問を返さない・POST 409。reopen で復帰
- 回答上限: 1000 件で 409 `survey_full`（同時送信で超えない——1文の条件付き挿入）
- 検証: required 欠落 400・options 外の値 400・checkbox の部分集合・2000字
- staff 系: 参加者 403・別イベントの survey id 差し込み 404（子リソース所有）・
  結果の件数/割合・自由記述一覧・ログイン/匿名の内訳
- 質問削除で回答が CASCADE・イベント削除で全消え・mergeUsers 付け替え
- **門の変異テスト**: 公開 GET のトークン照合を外すと落ちる実証（#436 と同じ型）

## 6. やらないこと

- ~~CSV エクスポート~~ → #447 で実装済み（表ビュー＋クライアント生成 CSV。
  BOM 付き・RFC 4180・数式インジェクション対策）
- 1人1回の厳密な担保・CAPTCHA・レート制限（§3.3 の割り切り。荒らしは再発行＋
  クローズ＋上限で受ける）
- 複数アンケート/イベント・締切日時の自動クローズ・回答の編集/削除（回答者側）
- 複製でのコピー（§3.8）・回答者への通知・公開イベントの事後アンケート（#153 の領分）
