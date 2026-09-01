# 出会いランキングのリアルタイム投影 (#418)

- 対象: `apps/server`（D1 スキーマ・ルート・リポジトリ）、`packages/shared`（設定の型・入力）、
  `apps/web`（投影ページ・イベント編集のトグル）
- ステータス: **実装済み**（PR #432 / issue #418、コミット 11393dd）。設計から変えた点は
  §5「設計からの差分」
- 関連修正: 出会いQRの見張りをブラウザの可視状態に依存させない修正は PR #421
  （issue #420。記録経路（QR表示）側の修正で、ランキング本体には影響しない）
- 決定済み（issue コメント 2026-08-26、ユーザー指示）:
  - 出すかどうかは**イベントごとの設定**。オフなら表示・API とも**存在ごと出さない**
  - **名前を出すか・匿名で出すかも設定**で切り替える
  - 主用途は**主催側がランキングページをプロジェクターで映す**こと。大写しで読める見た目が最優先
  - 配信セットのシーン化より**独立ページを先に**（シーン化は後から足せる形に）

---

## 1. なぜ作るか

出会いの記録（QRの読み合い #304/#324/#330）は既にあり、集計 SQL も
`eventMeetsRepo.rankingForEvent`（スタッフ運営用・景品配布の参考）として存在する。
これを開催中に会場へ大写しにして、交流を盛り上げる仕掛けにする。

---

## 2. 調査結果

### 2.1 出会いの記録といまの露出範囲

`event_meet` はペア（`user_low`/`user_high` に正規化）をイベントごとに1行。
「誰が誰と出会ったか」がいま外へ出る経路を洗い出した（#383 の型に倣う）。

| # | 経路 | 見える人 | 見える内容 |
|---|------|---------|-----------|
| 1 | `GET /events/:id/meets/ranking`（`routes/eventMeets.ts:46`） | **staff のみ** | 名前・アバター・件数（上位100） |
| 2 | スキャン結果・通知（`/api/meet/scan`） | **当事者ペアのみ** | 相手の名前 |
| 3 | 公開プロフィール（`routes/public.ts:86-106`） | 誰でも | **本人の**イベント別件数・通算人数。**相手は出ない** |
| 4 | イベント統計ページの `MeetRankingCard`（`EventStatsPage.tsx:550`） | staff のみ（経路1のUI） | 同上 |

つまり既存の設計姿勢は「**件数は本人の公開実績、名前入りランキングは staff 限定**」。
参加者全員（まして会場全体）に名前つき順位を見せるのは**新しい露出**であり、
イベントごとのオプトイン（既定オフ）にする決定と整合する。

なお「読み取った側を隠す」型の配慮は、既存には**通知の文言レベルでは無い**
（scan で両者に相手の名前が通知される。対面で読み合う機能なので当然）。
隠しているのは「ペアの組み合わせを第三者に出さない」ことで、本設計もそれを維持する
（ランキングは**件数のみ**。誰と誰が出会ったかは出さない）。

### 2.2 投影ページの先例

| 先例 | 作法 |
|------|------|
| `LiveScreenPage.tsx`（配信画面） | `position:fixed; inset:0`・16:9・カーソル3秒自動非表示・staff 専用 API を1秒ポーリング（`LIVE_POLL_MS=1000`） |
| `EventChatScreenPage.tsx`（チャット投影 #215） | 全画面・**文字サイズ倍率**（`SCALES=[0.8,1,1.25,1.5,2]` を localStorage に保存）・カーソル自動非表示・`onMouseMove/onTouchStart/onKeyDown` で復帰・権限は「参加確定メンバー」 |
| `EventTimetablePage.tsx` | イベント配下のネスト Route |

投影ページは `EventChatScreenPage` の型（全画面 + 文字サイズ倍率 + カーソル自動非表示 +
参加確定メンバー権限）をそのまま踏襲する。1秒ポーリング（live-state）は staff 専用の
配信同期用であり、ランキングはそれに乗る必要が無い（→ §3.4）。

### 2.3 イベント設定のトグルの先例

- 列追加: `migrations/0021_photos_public.sql`（`ALTER TABLE event ADD COLUMN ... NOT NULL DEFAULT 0`）。次番号は **0078**
- 3値の設定: `qa_anonymity`（`QA_ANONYMITY_MODES` の enum を shared に置く）
- 反映箇所: `packages/shared/src/schema.ts`（`eventSchema` + `updateEventInput`）、
  `events.ts` リポジトリの行マッピング（:121 付近）と `update`（:394 付近）、
  イベント複製のコピーリスト（`routes/events.ts:448` 付近）、`EditEventPage.tsx` のトグル群
- オフ時のサーバ側ガードの先例: `eventQa.ts:151` の `if (!event.qaEnabled) return 409`。
  ただし本件は「存在ごと出さない」なので 409 ではなく **404（イベント不存在と同一応答）** にする

---

## 3. 設計

### 3.1 設定: 1列の3値 `meet_ranking`

**`event.meet_ranking TEXT NOT NULL DEFAULT 'off'`、値は `'off' | 'anonymous' | 'named'`。**

2軸（出す/出さない × 名前/匿名）を**列2本ではなく1列の3値**で持つ。理由:

- **ゲートと見せ方が同じ1つの契約になる。** オフ判定は `!== 'off'` の1述語、表示分岐は
  `=== 'named'` の1述語で、どちらも同じ列を読む。列2本だと「enabled=0 だが named=1」の
  ように**意味の無い組み合わせが表現できてしまい**、読む側が毎回2列を合成することになる
  （「設定の口が2通り」の型）
- 既存の `qa_anonymity` も enum 1列で、shared に enum を置く型が確立している

列2本の利点は「オフにしても名前/匿名の選択が残る」ことだけ。再オンのとき選び直せば済む
（編集UIの選択1つ）ので、この利点のために不正な状態空間を持ち込まない。

**既定は `'off'`。** 理由: 名前が会場に大写しになりうる機能で、ランキングを望まない場
（もくもく会・勉強会など交流が主目的でないイベント）のほうが多い。出したいイベントだけが
明示的にオンにするのが安全側。既存の `photosPublic`（既定オフ）とも姿勢が揃う。

編集UIで**オンにしたときの初期値は `'named'`**（承認済み）とする。オンにする行為自体が
「盛り上げに使う」という明示的な選択であり、主用途（名前入りで競う）に一致するため。
慎重な場は匿名を選べる。選択肢の説明文に「名前とアイコンが会場に大写しになります」と
振る舞いで書く（実装技術の語は出さない）。

マイグレーション `apps/server/migrations/0078_meet_ranking.sql`:

```sql
-- 出会いランキングの表示設定 (#418)。off=出さない / anonymous=件数のみ / named=名前入り
ALTER TABLE event ADD COLUMN meet_ranking TEXT NOT NULL DEFAULT 'off';
```

shared（enum は `packages/shared/src/eventMeets.ts` に置き、`schema.ts` が import する）:

```ts
export const MEET_RANKING_MODES = ["off", "anonymous", "named"] as const;
// eventSchema に追加
meetRanking: z.enum(MEET_RANKING_MODES),
// updateEventInput に追加（createEventInput には入れない。chatEnabled 等と同じく編集でのみ設定）
meetRanking: z.enum(MEET_RANKING_MODES).optional(),
```

反映箇所（先例どおり）: `events.ts` リポジトリの行マッピングと `update` の UPDATE 文、
イベント複製のコピーリスト（設定だけコピー。記録はコピーしない —— `qaEnabled` と同じ扱い）、
`EditEventPage.tsx` のスイッチ + named/anonymous のセレクト（chat/Q&A トグル群の並び）。

### 3.2 どこに出すか: 専用投影ページを主軸

**`/events/:id/meet-ranking/screen`（新規ページ `MeetRankingScreenPage.tsx`）を主役にする。**

- 余計な UI の無い全画面。`EventChatScreenPage` の型を踏襲:
  `position:fixed; inset:0`・文字サイズ倍率（localStorage キーは別名 `eventer:meetRankingScreenScale`）・
  カーソル3秒自動非表示・`onMouseMove/onTouchStart/onKeyDown` で復帰
- 大写しで読める見た目を最優先: 上位ほど大きく（1〜3位は特大 + メダル色、以降は等サイズの行）、
  行数は**上位10件固定**（プロジェクターで読める限界。100件出しても後ろの席から読めない）
- 色は DESIGN.md（Natsumatsuri）の投影系（`LiveScreenPage`/デフォルト配信セットと同じ
  夜空ダーク `#0E1426` + ティール `#2DD4BF` 系）に合わせ、周囲の配信画面と並べても浮かないようにする
- ナビゲーションの入口: イベント詳細ページの、設定がオンのときだけ出るランキングカード
  （§3.7）から開く。`EventStatsPage` の staff 用カードにも投影ページへのリンクを足す

**配信セットのシーン化はやらない（後から足せる形にはする）。** 独立ページなら配信の仕組みに
依存せず単体で映せて運用が軽い。将来シーン化するときは `LIVE_ELEMENT_TYPES` に
`meetRanking` を足し、`LiveRuntime` にレンダラを1つ足すだけでよい（データは §3.3 の
API をそのまま使う）。今回はその拡張を妨げない形（ランキング描画を小さな部品
`MeetRankingBoard` に切り出してページが包む）にとどめる。

**イベント詳細のパネルは従属**（§3.7。小さく出して投影ページへの入口を兼ねる）。

### 3.3 API: 参加者向けの読み取り1本を新設

既存の staff 用 `GET /events/:id/meets/ranking` は**そのまま残す**（運営・景品配布用。
上位100・名前入り・staff 限定）。これは #418 以前からある運営機能で、`meet_ranking`
設定には**従わせない**（匿名設定のイベントでも運営は景品配布に名前入りが要る。
「オフなら出さない」の決定は参加者・会場向けの新機能についてのもの）。

新設: **`GET /api/events/:id/meets/ranking/live`**（`routes/eventMeets.ts` の
`meetEventRoutes` に追加。認証必須 + 参加確定メンバー）。

```
応答（mode により形が変わる。匿名のとき個人を特定できる値は一切載せない）:

named:     { mode: "named",
             ranking: [{ rank, userId, username, name, avatarUrl, count }],  // 上位10
             totalRanked }                                                   // 1件以上の人数
anonymous: { mode: "anonymous",
             ranking: [{ rank, count, people }],   // 件数ごとに集約。people=その件数の人数
             totalRanked }
共通:      me: { rank, count } | null              // 呼び出した本人の順位（0件なら null）
```

- **`meet_ranking = 'off'`・非メンバー・未確定メンバーはいずれも `{ error: "not_found" }, 404`**
  —— イベントIDが存在しないときと同一のステータス・同一のボディにし、外から設定の有無も
  機能の存在も判別できないようにする（§3.8）。未ログインは他の `/api/events` 配下と同じく
  `requireAuth` の 401（何も明かさない）
- 匿名モードで名前入りの行を返さないのはサーバ側で保証する（クライアントで伏せるのは偽の匿名）。
  匿名の応答には `userId` すら載せない
- `me` は本人自身の値なので匿名モードでも返してよい（公開プロフィールが既に本人の件数を
  出している。§2.1 経路3）

リポジトリ（`eventMeets.ts`）は既存の `rankingForEvent` を**1本の集計契約のまま**拡張する:

- `rankingForEvent(eventId, limit)` に `RANK() OVER (ORDER BY n DESC)` を足して
  `rank` を返す（staff 用・named 用の共用。呼び出し側で limit 100 / 10）。
  D1(SQLite) はウィンドウ関数対応
- `anonymousRankingForEvent(eventId, limit)`: 件数で GROUP BY した
  `{ n, people }` を返し、rank は累積人数から算出（1位2人なら次は3位。§3.6 と同じ規則）
- `rankForUser(eventId, userId)`: 本人の件数と
  `1 + (自分より件数が多い人数)` で順位を返す

集計の元 SQL（両方向 UNION ALL → GROUP BY）は既存の1か所を共用し、
**同じ集計を2か所に書かない**。

### 3.4 更新間隔: 5秒ポーリング

**専用の 5 秒間隔**（`MEET_RANKING_POLL_MS = 5000` を shared の定数に）で、
react-query の `refetchInterval` により投影ページがポーリングする。

- 1秒（`LIVE_POLL_MS`）に乗せない: live-state は staff 専用の配信同期（シーン切替の
  体感即時性が要る）。ランキングは QR を読み合う人間の速度でしか変わらず、数秒遅れても
  誰も困らない。会場の全参加者が手元でも開く可能性がある（§3.5）ので、1秒×人数分の
  リクエストを D1 に流す理由が無い
- 5秒なら「読んだらすぐ画面に反映された」という体感は保てる（記録→次の描画まで最大5秒）

### 3.5 誰が開けるか: 参加確定メンバー

投影ページと live API は**参加確定メンバー（staff 含む）だけ**が開ける
（チャット投影ページと同じ基準）。映す運用は staff だが、参加者が手元のスマホでも
開けるようにする。理由:

- 手元で順位が動くのを見られるほうが盛り上がり、`me`（自分の順位）も手元でだけ意味を持つ
- named モードの名前・アバターは**そのイベントの参加者の中に閉じる**。参加者一覧等で
  互いの名前が既に見えている集合なので、新しい露出は「順位と件数」だけになる
- 非メンバー・未ログインには開けない（URL が外に流れても名前入りランキングは見えない）

認可の実装は既存の `requireEventRole` をそのまま使えない（participant も通すが
「確定メンバーのみ」の条件が要る）。`eventMembersRepo.find` で
`status === 'confirmed'` を確かめ、満たさないときは **403 ではなく設定オフと同じ 404**
を返す（機能の存在ごと非メンバーに見せない。§3.8）。

### 3.6 同率の扱い: 同順位・次はスキップ

**競技順位（1,2,2,4）**にする。同数は同じ順位、次の順位は人数分飛ぶ。
「2位が2人」が大写しでも直感どおりで、SQL の `RANK()` がそのまま出す値でもある。

named モードの表示順は `count DESC, username ASC`（既存 `rankingForEvent` と同じ）。
第2キーを固定することで、ポーリングのたびに同率内で行が入れ替わってちらつくのを防ぐ。
匿名モードは件数ごとに1行へ集約するので同率問題自体が消える（`2位 9人と出会った（2人）`）。

### 3.7 開催中だけか: 時間では絞らない

**時間帯による絞りは入れない。** 設定がオンである限り、開催前も終了後も見られる。

- 記録できる時間は書き込み側（`MEET_WINDOW_BEFORE_MS`〜`MEET_WINDOW_AFTER_MS`）が
  既に絞っており、終了2時間後からランキングは自然に凍結する
- 終了後に見えて困る情報ではない（打ち上げ・振り返りでむしろ役立つ。staff 用ランキングも
  終了後に景品配布で使う前提）。出したくなければ設定をオフに戻せば消える
- 時間の門を足すと「開催中」の定義がもう1つ増える（門の上に門）

イベント詳細の従属パネル（小さなカード: 上位3件 + 自分の順位 + 投影ページへのリンク）も
同じ条件（設定オン + 確定メンバー）でだけ出す。

### 3.8 オフのとき「存在ごと出さない」の保証

#383 の教訓（1か所に条件を書いたつもりが5か所だった）に倣い、**ランキングが外へ出る
経路を全数で挙げ、門を1か所に置く**。

出る経路は次の2本だけにする:

| 経路 | 門 |
|------|----|
| `GET /:id/meets/ranking/live`（新設） | ルート先頭で `event.meetRanking === 'off'` または確定メンバーでないなら **404 not_found**（イベント不存在と同一応答）。**サーバ側のこの1か所が正**の門 |
| `GET /:id/meets/ranking`（既存 staff 用） | 従来どおり staff 限定。設定には従わない（運営用。§3.3） |

- Web 側（投影ページ・詳細パネル・リンク）は `event.meetRanking !== 'off'` のときだけ
  描画するが、これは**利便のためで防御ではない**。防御はサーバの 404 が担う
- `meetRanking` の設定値自体はイベント payload に載る（`qaEnabled` 等と同列のメタデータ。
  設定の存在が見えることと、ランキングの中身が見えることは別）
- ランキングを**新たに数える SQL を他の場所に書かない**こと（プロフィール・名札・
  ゲーミフィケーション等に「順位」を足したくなったら、この設計に戻って経路表を更新する）。
  既存の「本人の件数」（`routes/public.ts`）は本人の実績であり、この門の対象外

### 3.9 見た目・アニメーション（凝りすぎない範囲）

- 行は `userId`（匿名モードは `count`）を key にし、順位変動は **FLIP 相当の
  CSS transform 遷移**（数百msで行がするっと入れ替わる）。ライブラリは入れない
- 件数が増えた行は短くハイライト（背景をひと呼吸光らせる程度）
- 圏外→圏内に入った行はフェードイン。派手な紙吹雪などはやらない
- 上部にイベントタイトルと「出会いランキング」の見出し、下部に `totalRanked`
  （「これまでに N 人が出会いを記録」）を小さく出して全体感を添える
- 0件のときは「最初の出会いを待っています」のような待機表示（空画面を映さない）

### 3.10 i18n・文言

`packages/shared/src/i18n/messages/eventSocial.ts`（参加者向け）に ja/en を追加:
見出し・待機表示・`totalRanked` の文・匿名行の文言（`9人と出会った（2人）`）・
自分の順位（`あなたは 5位（7人）`）。設定トグルの文言は `EditEventPage` が使う
messages に追加し、**振る舞いで書く**（「名前とアイコンが会場に大写しになります」）。
既存 staff 用カードの注記（`staffOps.meetRankingNote`「スタッフのみ閲覧できます」）は、
設定がオンのイベントでは正確でなくなるため「参加者向けランキングとは別に、全順位を
名前入りで見られます」の趣旨に直す。

---

## 4. 変更ファイル一覧

| 層 | ファイル | 変更 |
|----|---------|------|
| DB | `apps/server/migrations/0078_meet_ranking.sql` | 新規。`meet_ranking` 列 |
| shared | `packages/shared/src/schema.ts` | `eventSchema`/`updateEventInput` に `meetRanking` |
| shared | `packages/shared/src/eventMeets.ts` | `MEET_RANKING_MODES`・`MEET_RANKING_POLL_MS = 5000`・`MEET_RANKING_TOP_N = 10`・live 応答の型 |
| server | `db/repositories/events.ts` | 行マッピング・UPDATE 文に `meet_ranking` |
| server | `db/repositories/eventMeets.ts` | `rankingForEvent` に rank 追加、`anonymousRankingForEvent`・`rankForUser` 新設 |
| server | `routes/eventMeets.ts` | `GET /:id/meets/ranking/live` 新設（off→404 / 確定メンバー判定 / mode 別応答） |
| server | `routes/events.ts` | 複製のコピーリストに `meetRanking` |
| web | `pages/MeetRankingScreenPage.tsx` | 新規。投影ページ（全画面枠。描画は `MeetRankingBoard`） |
| web | `components/MeetRanking.tsx` | 新規。`MeetRankingBoard`（投影の描画）+ `MeetRankingPanel`（詳細ページの小カード） |
| web | `App.tsx` | `/events/:id/meet-ranking/screen` の Route |
| web | `api/eventMeetHooks.ts` | `useMeetRankingLive(eventId, enabled)`（refetchInterval 5s） |
| web | `pages/EditEventPage.tsx` | スイッチ + named/anonymous の選択（Q&A の匿名設定と同じセレクト） |
| web | `pages/EventDetailPage.tsx` | 従属パネル（上位3 + 自分の順位 + 投影ページへのリンク） |
| web | `pages/EventStatsPage.tsx` | staff カードに投影ページへのリンク・注記の文言修正 |
| i18n | `eventSocial.ts`・`eventForm.ts`・`staffOps.ts` | ja/en 追加（参加者向け・設定トグル・staff カード注記） |
| test | `apps/server/test/meet-ranking.test.ts` | 新規。下記の観点 |

### テスト観点（server）

- off のとき live API が 404（存在しないイベントIDと同一応答）であること
- named/anonymous それぞれの応答形。**匿名応答に userId/name/avatarUrl が含まれない**こと
- 非メンバー・未確定メンバーが弾かれること。staff 用ランキングは設定に依らず staff に返ること
- 同率の rank（1,2,2,4）と第2キーの安定
- 複製で設定がコピーされること

---

## 5. 設計からの差分

レビュー・実装で設計から変えた点（いずれもコードで確認済み）:

- **非メンバー・未確定メンバーにも 404**（§3.5/§3.8 の強化）。403 を返さず、設定オフ・
  イベント不存在と同一応答にして機能の存在ごと隠す（`routes/eventMeets.ts` の
  `/:id/meets/ranking/live` 先頭の1判定）
- 上位10件は定数 **`MEET_RANKING_TOP_N`** として shared に置いた（ルートとUIで数字を
  2か所に書かない）
- 定数・enum の置き場は `schema.ts` ではなく **`packages/shared/src/eventMeets.ts`**
  （`MEET_RANKING_MODES`・`MEET_RANKING_POLL_MS`・応答型を同居させ、`schema.ts` は import）
- 投影の描画（`MeetRankingBoard`）と詳細ページの小カード（`MeetRankingPanel`）は
  **`components/MeetRanking.tsx` に同居**（データ取得は同じ live API の5秒ポーリング）
- ポーリングは**エラー時に停止**する（`api/eventMeetHooks.ts` の `refetchInterval`。
  オフ・非メンバーの 404 に5秒おきに当たり続けない）

---

## 6. やらないこと

- 配信セットのシーン化（`LIVE_ELEMENT_TYPES` への追加）。後から `MeetRankingBoard` を
  包むだけで足せる形にはしておく
- 「上位Nだけ・本人にだけ順位」等の匿名性の中間案（named/anonymous の2択を設定にする
  決定で不要になった）
- 時間帯によるランキングの出し分け（§3.7）
- 順位変動の履歴・グラフ・紙吹雪等の演出強化
