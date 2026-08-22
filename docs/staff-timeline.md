# スタッフ用タイムライン（準備・片付け・裏方トラック） (#383)

- 対象: `apps/server`（D1 スキーマ・スケジュールのリポジトリ・タイムテーブルのルート）、
  `packages/shared`（時刻の計算・保存の入力）、`apps/web`（編集と表示）
- 前提: #384（スタッフの役割タグ）の**着手前**に入れること。あちらは本設計の時間帯に役割を当てる
- ステータス: **実装済み**。見せ方 (7.) は相談して決めた（7. の頭に結論を書いた）

---

## 1. なぜ作るか

準備・設営・リハーサル・片付けのような、**参加者に見せない段取り**を置く場所が無い。
いまタイムテーブルに書けば参加者に見え、書かなければ運営の頭の中と外部のメモに残る。

要件は4つ (#383)。

1. 準備時間・片付け時間など、**表に出ない項目**を置ける
2. **表のトラックと連動する**。どのトラックの裏方なのかが分かる（時間軸が揃っていないと使えない）
3. **スタッフ用の追加トラック**が要る。表には無い列。控え室の留守番のように、
   どのセッションにも紐づかない持ち場があるため
4. **スタッフにしか見えない**

4 が本設計でいちばん危ない。**参加者に見せる経路から裏方の項目が1つでも漏れたら事故**で、
しかも漏れたことは誰も報告してくれない（参加者は「そういうものか」と思って読む）。

---

## 2. 調査結果

### 2.1 いまのデータの形

`apps/server/migrations/0067_schedule_tracks.sql`（#338）で3つある。

| 表 | 中身 |
|---|---|
| `event_track` | トラックの定義（`name` と `sort_order`）。会場の部屋とは紐づかない |
| `event_schedule_item` | セッション。`placement` 列で配置状態を持つ |
| `event_schedule_item_track` | セッションとトラックの対応表（多対多） |

`placement` は `'unassigned'`（未割り当て＝ネタ出し中）/ `'all'`（全トラック共通）/
`'tracks'`（特定のトラック）の3値。**`unassigned` と `all` はどちらも対応表が空**なので、
対応表の有無では区別できない。だから列で持っている。

### 2.2 参加者に見せる経路（洗い出し）

`event_schedule_item` の中身（タイトル・時刻・説明・担当・資料URL）が外へ出る経路を、
`eventScheduleRepo` の呼び出し元と `event_schedule_item` を含む SQL の全数から洗い出した。

| # | 経路 | いまの取得元 | いまの絞り込み |
|---|------|------------|--------------|
| 1 | `GET /api/events/:id/timetable` | `eventScheduleRepo.listByEvent` + `listTracks` | `routes/eventSchedule.ts:71` の JS `filter` |
| 2 | イベント詳細の一覧（`EventSchedule.tsx`） | **1 と同じ** hook (`useEventSchedule`) | 画面側では絞らない |
| 3 | 資料ギャラリー（`EventMaterials.tsx`） | **1 と同じ** hook | 画面側では絞らない |
| 4 | 投影のタイムテーブル（`EventTimetablePage.tsx` = `/events/:id/timetable` の格子） | **1 と同じ** hook | 画面側では絞らない |
| 5 | 前日リマインダーのメール本文 | `listByEvent`（`lib/email.ts:166` の JS `filter`） | `placement !== 'unassigned'` |
| 6 | 公開プロフィールの登壇イベント（`listPublicSpokenEventIds`） | 独自 SQL（`eventSchedule.ts:438`） | SQL の `si.placement != 'unassigned'` |
| 7 | 資料URLの自己編集 `PATCH /:id/timetable/:itemId/material` | 独自 SELECT | **絞り込み無し**（登壇者本人かどうかだけ） |
| 8 | OG メタの取得 `listNeedingOgRefresh` → 外部ホストへ fetch | 独自 SQL | **絞り込み無し** |
| 9 | タイムテーブルの保存 `PUT /:id/timetable` | `listByEvent` / `listIds` | staff 限定（`requireEventRole(["staff"])`） |
| 10 | 公開プロフィールの参加実績「登壇 N 回」 | 独自 SQL（`eventMembers.ts:322`） | **絞り込み無し** |
| 11 | 名札／名刺の「登壇 N 回」（イベント内） | 独自 SQL（`nameCards.ts:87`） | **絞り込み無し** |
| 12 | 名札／名刺の「登壇 N 回」（終了済み公開イベント） | 独自 SQL（`nameCards.ts:163`） | **絞り込み無し** |
| 13 | ゲーミフィケーションの「登壇」の数え上げ | 独自 SQL（`gamification.ts:47`） | **絞り込み無し** |

**10〜13 は、いますでに漏れている。** 0067 は `listPublicSpokenEventIds`（経路 6）に
「未割り当ては参加者に見せないので、ここでも数えない」とコメントまで書いて条件を入れたが、
**同じことを数えている他の4か所には入っていない**。
いまでも、未割り当て（ネタ出し中）のコマの担当に指名された人は、
公開プロフィールと名刺の「登壇 N 回」が1つ増える。

裏方を足すと、**準備の担当に指名されただけの人の「登壇」が公開の数字として増える**。
数字1つなので害は小さいが、経路としては同じ穴で、しかも
**「1か所に条件を書いたつもりが実は5か所だった」ことの直接の証拠**でもある。
本 PR で5か所とも 5.1 の共通の断片に寄せる。

**外へ出ていないことを確認した経路**（変更不要）:

- 出席 CSV (`routes/attendanceCsv.ts`) — スケジュール項目を読んでいない
- フィード (`routes/feeds.ts`) — 同上
- 一斉連絡・チャット・Q&A・通知の本文 — 同上
- 投影/配信の画面（`LiveScreenPage` / `PresentPage` / `LiveControlPage` / `EventChatScreenPage`）
  — `useEventSchedule` を呼んでいない
- 公開ページ (`routes/public.ts`) — 6 の `listPublicSpokenEventIds` しか呼んでいない
- イベントの複製 (`routes/events.ts:410-495`) — 参加枠・採点基準・表彰はコピーするが
  **タイムテーブルはコピーしない**

タイムテーブルの `useEventSchedule`（`api/eventScheduleHooks.ts`）を呼んでいる画面は
**2・3・4 の3つだけ**で、すべて 1 の API 1本に集まっている。フロントは 1 を塞げば塞がる。

（`SchedulePanel`（日程調整）にも `useEventSchedule` があるが、あちらは
`api/scheduleHooks.ts` の**同名の別フック**で、叩き先は `/events/:id/schedule`。
タイムテーブルの項目は取っていないので経路ではない。**同じ名前のフックが2つある**ので、
「呼び出し元を全部見た」と言うときは import 元まで確かめること。）

### 2.3 絞り込みの契約はいま何か所にあるか

`routes/eventSchedule.ts:58` のコメントはこう書いてある。

> **未割り当て（ネタ出し中）は staff にしか返さない** (#338)。
> 参加者に見せない、という判断はここ1か所だけが持つ。

**これは事実ではない。実際には4か所ある。**

1. `apps/server/src/routes/eventSchedule.ts:71` — `items.filter((it) => it.placement !== "unassigned")`
2. `apps/server/src/lib/email.ts:166` — 同じ `filter` を書き写している
3. `apps/server/src/db/repositories/eventSchedule.ts:438` — SQL の `AND si.placement != 'unassigned'`
4. `apps/web/src/components/EventMaterials.tsx:114` / `EventSchedule.tsx:193` —
   こちらは「届いたものに印を付ける」だけで絞ってはいない（正しい作り）

そして**書かれるべき場所に書かれていないところが4か所**ある（2.2 の経路 10〜13）。
`eventMembers.ts:322` / `nameCards.ts:87` / `nameCards.ts:163` / `gamification.ts:47` の
「登壇 N 回」は、3 とまったく同じことを数えているのに条件を持っていない。

つまり**「絞り込みは1か所」という前提のほうが先に壊れている**。ここに
「スタッフにしか見せない」という2本目の軸を足すと、7 か所 × 2 軸で 14 通りの書き忘れができる。
`placement` の値を増やすだけの案（3.2 案A）が危ないのは、**1〜3 が
`!= 'unassigned'` と書いてあるせいで、新しい値が黙って通り抜ける**ためでもある。

もう一つ、同じ契約の重複がある。`routes/eventSchedule.ts` の `canEditTimetable` は
`auth/roles.ts` の `canManageEvent` とまったく同じ判定を書き写している
（アプリ管理者 / `event_member.role === 'staff'` / コミュニティの owner・admin）。
`canManageEvent` 自身が「2か所に書くと必ずずれる」と書いて作られた関数なので、
**本 PR でここを寄せる**。

### 2.4 時刻の連鎖（この節が本設計をいちばん強く縛る）

`packages/shared/src/eventSchedule.ts` の `computeScheduleTimes` は、
**トラックごとにカーソルを持って前から連鎖**する。

- `unassigned` … 時刻を持たない (`null`)。**どのカーソルも進めない**
- `all` … 全トラックのカーソルのうちいちばん後ろから始まり、**全カーソルを進める**
- `tracks` … そのトラックのカーソルだけ見て、そのトラックだけ進める

`startsAt` が明示されていない項目は、**前の項目の終わりから**始まる。

ここから、本設計で最も見落としやすい不具合が出る。

> 裏方の項目が公開トラックのカーソルを進めると、
> **参加者の画面（裏方が抜けている）と staff の画面で、同じセッションの開始時刻がずれる。**

たとえばトラックAに「開会 10:00-10:10」「撤収準備（裏方）10:10-10:30」「発表 10:30-」
と並べると、参加者側は裏方が抜けるので「発表」が **10:10 開始**として描かれる。
会場では 10:30 に始まる。**参加者に配る時刻が壊れる。** リマインダーメールにも同じ時刻が載る。

したがって次を不変条件にする。

> **不可視の項目を配列から除いても、残る項目の時刻が1ミリ秒も変わらないこと。**

これが成り立たないかぎり、「取ってきたあとで除く」も「そもそも取らない」も
どちらも安全にならない。詳しくは 3.3。

---

## 3. 決めたこと（結論）

1. **スタッフ用トラックは `event_track` に `visibility` 列を足して同じ表で持つ**（3.1）
2. **表に出さない項目は `placement` の値を増やさず、`event_schedule_item.visibility` 列で持つ**（3.2）
3. **`visibility = 'staff'` の項目はカーソルを進めない**（3.3）
4. **絞り込みは「取ってきたあとで除く」をやめ、リポジトリの入口に `audience` を必須引数で置く**（5.）
5. **スタッフ専用のエンドポイントは作らない。** `GET /:id/timetable` 1本のまま、
   見える人には見える形で返す（6.）

### 3.1 スタッフ用トラックを同じ表で持つ（`event_track.visibility`）

```sql
ALTER TABLE event_track ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'staff'));
```

**採った理由**: 要件 2（時間軸が揃っていること）がすべて。

- 別表にすると `event_schedule_item_track` に相当する対応表がもう1本要る。
  「トラックを消したら、そこにしか載っていなかった項目は `unassigned` に落とす」という
  0067 の規則、`sort_order` の採番、差分保存の ID 保持（#340）が**全部二重化**する。
- `computeScheduleTimes` の列集合が2系統になる。表と裏で別々に連鎖を回すと、
  3.3 の不変条件を守る場所も2か所になる。
- 同じ表なら `sort_order` 1本で並び、既存の規則がそのまま効く。

**代償**: 「トラックの一覧」を取る経路すべてに、参加者向けかどうかの判断が要る。
これは 5. で入口1か所に寄せることで払う。

### 3.2 項目の見え方は `placement` ではなく別の列で持つ

3つ案を出して比べた。

#### 案A — `placement` に `'staff'` を足す（採らない）

`placement IN ('unassigned', 'all', 'tracks', 'staff')` にする。

- **代償1（致命的）**: 既存の絞り込みは 2.3 のとおり `!= 'unassigned'` と書いてある。
  `'staff'` は `'unassigned'` ではないので、**4か所すべてを黙って通り抜ける**。
  門を足し忘れた経路が、エラーも警告も出さずに参加者へ裏方を配る。
  「新しい値を足したら既存の判定が全部間違いになる」形の変更を、
  型でも制約でも検出できない。
- **代償2（要件を満たせない）**: `placement` は「**どの列に置くか**」の軸。
  `placement = 'staff'` にした瞬間、`trackIds` の意味が消える。
  要件 2 の「トラックAの裏方」が表現できなくなる。
- 代償3: SQLite は `CHECK` 制約の変更にテーブル再作成が要る。
  外部キーで参照されている `event_schedule_item` の作り直しは避けたい。

#### 案B — `event_schedule_item.visibility` を足す（**採用**）

```sql
ALTER TABLE event_schedule_item ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'staff'));
```

- `placement` は「**どの列か**」、`visibility` は「**誰に見せるか**」。
  直交する2つの問いを2つの列で持つ。混ぜない。
- 裏方の項目も `placement = 'tracks'` + `trackIds = [トラックA]` にできる。要件 2 を満たす。
- スタッフ用トラックに置く持ち場は `placement = 'tracks'` +
  `trackIds = [スタッフトラック]` + `visibility = 'staff'`。要件 3 を満たす。
- 全体の設営のように列をまたぐ裏方は `placement = 'all'` + `visibility = 'staff'`。
- 既存の判定を**書き換えなければ通らない**。`visibility` を見ていない SQL は
  裏方を返してしまうが、それは 5. の入口1か所と 9.10 の監査テストで捕まえる。

**代償**: 不整合の組み合わせが1つ生まれる。
`visibility = 'public'` の項目がスタッフ用トラックにだけ載っている状態。
これは 0067 が「`'tracks'` なのに対応表が空、という状態は作らない」で解いたのと同じやり方、
つまり**サーバー側で作らせない**ことにする（4.2 の規則2）。

#### 案C — スタッフ用トラックを表のトラックの影として持つ（`event_track.shadow_of`）(採らない)

表のトラックそれぞれに、対になる裏方トラックをぶら下げる。
項目の見え方はトラックから導く（裏方トラックに載っていれば裏方）。列は1軸で済む。

- 代償1: トラックの本数が最大で倍になる。編集画面のトラック一覧も倍。
  `sort_order` に「影は本体の直後」という暗黙の規則が生まれ、並べ替えが難しくなる。
- 代償2: 「トラックAの裏方」を置くのに、先に影トラックを作る操作が要る。
  トラックを使っていないイベント（大多数）でも影トラックを作らないと裏方が置けない。
- 代償3: 表のトラックを消すと影も消える／残す、の規則が新たに要る。
- 利点（軸が1本）は、案Bで `visibility` を**許可リストで書く**（4.3）ことで
  実質的に埋まる。複雑さに見合わない。

### 3.3 不可視の項目はカーソルを進めない

2.4 の不変条件を実装で保証する。`computeScheduleTimes` の規則に1行足す。

- `unassigned` … カーソルを**読まない・進めない**（時刻を持たない。いまのまま）
- `visibility = 'staff'` … カーソルを**読む・進めない**

読むのは、裏方に時刻を出したいから（「準備 9:30」と描きたい）。
進めないのは、参加者側で抜いたときに残りが動かないようにするため。

```ts
// computeScheduleTimes のループの中、out.push(start) の直後
// 裏方 (#383) は参加者に返らない。カーソルを進めると、抜けた側と抜けていない側で
// 同じセッションの時刻がずれる。**読むが進めない**
if (it.visibility === "staff") continue;
```

あわせて、`all`（全トラック共通）が占める列 `columns` には
**スタッフ用トラックを入れない**。入れると、スタッフ用トラックのカーソルが
`Math.max(...known)` に混ざり、**staff の画面でだけ `all` の時刻が後ろへずれる**。
`computeScheduleTimes` の第3引数に渡すトラック ID は、
staff で見ているときも**公開トラックだけ**にする。

**この絞り込みも1か所に持つ**（`packages/shared` の `publicTracks`）。
`computeScheduleTimes` を呼ぶ場所はサーバー・投影の格子・イベント詳細・編集画面の
プレビューと散らばっていて、**各画面で書き写すと新しい画面が素直に「全部のトラック」を
渡してそこだけ静かにずれる**。5.1 で SQL の断片を1か所にしたのと同じ理由。

**代償**: 裏方の項目どうしが自動で連鎖しない。「準備 30分」「設営 30分」を続けて置くと
どちらも同じ時刻から始まる。回避は `startsAt` を明示すること。
準備・片付けは「9:00 に入館」のように絶対時刻で決まることが多いので実害は小さいと見た。
重なりは既存の `findTrackOverlaps` が編集画面で警告する（保存は止めない）ので気づける。

**決定（v1）: 裏方の時刻は明示のみとし、自動で連鎖させない。** スタッフ用トラックの
中だけで連鎖させる案もあるが、**連鎖の規則が2種類になるとどちらが効いているか
読めなくなる**。実際に使って不便なら後から足す。

---

## 4. マイグレーション

### 4.1 `apps/server/migrations/0072_staff_timeline.sql`

```sql
-- スタッフ用タイムライン (#383)。
--
-- 準備・設営・片付けのような、参加者に見せない段取りをタイムテーブルに置けるようにする。
-- 表のセッションと**同じ時間軸**に並べるのが目的なので、別のタイムテーブルは作らず、
-- 既存の event_schedule_item / event_track にそれぞれ1列だけ足す。
--
-- 軸は2本あり、**混ぜない**。
--
--   placement   … どの列に置くか（未割り当て / 全トラック共通 / 特定のトラック）
--   visibility  … 誰に見せるか（参加者にも見せる / スタッフだけ）
--
-- placement に 'staff' を足す案は採らなかった。既存の絞り込みが
-- `placement != 'unassigned'` と書いてあるため、新しい値が**黙って通り抜ける**。
-- しかも placement を 'staff' にすると trackIds の意味が消え、
-- 「トラックAの裏方」が表現できなくなる（それが要件そのもの）。

-- スタッフ用トラック。表には無い列（控え室の留守番のように、
-- どのセッションにも紐づかない持ち場を置く先）。
--
-- **既定は 'public'**。既存のトラックは全部これまでどおり参加者に見える。
-- 表のトラックと同じ表で持つのは、時間軸を1本に保つため。別表にすると
-- 対応表・並び順・「トラックを消したら unassigned に落とす」規則が二重化する。
ALTER TABLE event_track ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'staff'));

-- 項目の見え方。'public' = 参加者にも見せる / 'staff' = スタッフだけ。
--
-- **既定は 'public'**。0067 で placement の既定を 'all' にしたのと同じ理由で、
-- 既存の項目は列を足すだけで移行が済み、いまの見え方が変わらない。
-- 既定を 'staff' にすると、公開済みイベントのタイムテーブルが参加者から丸ごと消える。
--
-- 絞り込みは必ず **`visibility = 'public'`（許可リスト）** で書くこと。
-- `!= 'staff'`（拒否リスト）で書くと、将来値が増えたときに新しい値が参加者へ漏れる。
-- placement の `!= 'unassigned'` が実際にその形で、案A を採れなかった理由でもある。
ALTER TABLE event_schedule_item ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'staff'));

-- 参加者向けの取得は placement と visibility を**両方**見る（イベント単位）。
-- 0067 の (event_id, placement) は同じ用途の索引なので張り替える。2本持つ意味がない。
DROP INDEX IF EXISTS idx_schedule_placement;
CREATE INDEX idx_schedule_visible
  ON event_schedule_item(event_id, visibility, placement);
```

**埋め戻しは無い。** 既存の行はすべて `'public'` が正しい（裏方という概念がまだ無いので、
いま入っているものは全部表に出ているもの）。

### 4.2 サーバーが作らせない状態（保存時に正す）

0067 の「`'tracks'` なのに対応表が空、という状態は作らない」と同じ扱いで、
**保存の時点で落とす**。DB の制約では表現できない（列をまたぐ条件のため）。

1. **スタッフ用トラックにしか載っていない項目は `visibility = 'staff'` に格上げする。**
   参加者に見せると決まっている項目が、参加者に見えない列にだけ置かれている状態は
   意味を持たない。落とす先を「消す」ではなく「格上げ」にするのは、
   0067 が未割り当てへ落としたのと同じで、**運営の入力を捨てない**ため。
2. **`visibility = 'staff'` の項目が公開トラックに載るのは正しい**（要件 2 そのもの）。
   ここは正さない。
3. トラックを消したときに載る先が無くなった項目が `unassigned` に落ちるのは 0067 のまま。
   このとき `visibility` は触らない（`unassigned` は staff にしか返らないので二重に安全）。
4. **`visibility` の省略は「いまの値を保つ」。既定値 `'public'` を持たせない。**

   **実装中に見つけた穴（設計 6.2 の修正）。** 6.2 は `placement` と同じ考え方で
   `.default("public")` と書いていたが、これは**古いクライアントからの保存で
   裏方を全件公開にする**。`visibility` を知らないビルドはこのキーを送らず、
   zod が `'public'` を埋め、差分保存がそのまま書くため。参加者のイベント詳細・
   資料ギャラリー・投影の格子・**リマインダーのメール**に「会場設営」「撤収」が並び、
   差分保存なので元に戻せない。

   `placement` と扱いが違うのは、**間違えたときの向きが逆**だから。
   `placement` の既定 `'all'` は「見えすぎる」側に倒しても、既存データが
   もともと全部 `'all'` なので何も変わらない。`visibility` の既定 `'public'` は
   **運営が隠すと決めたものを公開に戻す**ので、倒れる先が事故になる。

   **「古いクライアントか」を `tracks` の有無で見分けてはいけない。**
   `tracks` は送るが `visibility` は送らないビルドが実在する（#338 と #383 の間）。
   見分けるのは `visibility` の有無そのもの1本にする。トラックの
   `visibility` も同じ規則（省略＝いまの値を保つ）。

### 4.3 切り戻し

コードだけ戻す場合、2つの列は残るが旧コードは無視する。
ただし**旧コードは `visibility` を見ないので、入力済みの裏方が参加者に出る。**
切り戻す前に `UPDATE event_schedule_item SET ... WHERE visibility = 'staff'` で
消すか、staging で確認してから戻すこと。列を落とす操作は不要。

---

## 5. 絞り込みの契約をどう1か所に保つか

**「取ってきたあとで除く」をやめ、「そもそも取らない」にする。**
2.3 のとおり、いま除いているのは3か所で、しかもコメントは「1か所」と言っている。
軸を1本足すのだから、まずこの前提を実在させる。

### 5.1 `audience` を必須引数にする

```ts
/** タイムテーブルを誰に見せるための取得か。
 * **既定値を持たせない**。新しい呼び出し元が現れたとき、
 * 付け忘れがコンパイルエラーになる側に倒す（黙って参加者へ漏れる側に倒さない） */
export type ScheduleAudience = "staff" | "public";

async listByEvent(eventId: string, audience: ScheduleAudience): Promise<ScheduleItem[]>
async listTracks(eventId: string, audience: ScheduleAudience): Promise<EventTrack[]>
```

`WHERE` に入れる。JS の `filter` は全部消す。

```ts
/** 参加者に見せてよい項目の条件。**この2つの軸を足すのはここだけ**。
 * 3本目の軸が要るようになったときも、直すのはここ1か所 */
const publicItemWhere = (alias: string) =>
  `${alias}.placement != 'unassigned' AND ${alias}.visibility = 'public'`;
```

- `listByEvent` … `audience === "staff"` なら条件を足さない、`"public"` なら `publicItemWhere("s")`
- `listTracks` … `"public"` なら `visibility = 'public'`
- `listPublicSpokenEventIds`（経路 6）… `publicItemWhere("si")` に置き換える
- 「登壇 N 回」を数える4か所（経路 10〜13。`eventMembers.ts:322` / `nameCards.ts:87` /
  `nameCards.ts:163` / `gamification.ts:47`）… 同じ `publicItemWhere("si")` を足す。
  **これらは `eventSchedule.ts` の外にある**ので、断片は
  `db/repositories/eventSchedule.ts` から `export` する。
  「登壇として数えてよい項目」の定義が5か所に散っている状態を、これで1か所にする
- 対応表の JOIN（`listByEvent` の2本目のクエリ）も `"public"` のときは
  スタッフ用トラックの行を返さない。**返すと `trackIds` にスタッフ用トラックの ID が混ざり、
  トラックの一覧には無い ID を画面が受け取る**（描画は壊れないが、ID の存在自体が漏れる）

### 5.2 呼び出し元での `audience` の決め方

`audience` を決めるのは**1か所だけ**にする。

```ts
// routes/eventSchedule.ts
const audience: ScheduleAudience = (await canManageEvent2(eventId, c)) ? "staff" : "public";
```

`canEditTimetable` は消して `auth/roles.ts` の `canManageEvent` に寄せる（2.3）。
`canManageEvent` は `User` を取るので、`Context` から引く薄い包みだけ足す。
これで「タイムテーブルを編集できる人」と「裏方が見える人」と
「`PUT` が通る人」が**同じ1つの関数**になる。いまコメントで
「同じ範囲にそろえる」と書いて人手で保っている約束が、実装として1本になる。

### 5.3 メールは常に `"public"` 固定にする（経路 5）

`lib/email.ts` の `buildEventExtraHtml` は、組み立てた HTML を
**`eventId:withTimetable` をキーにしてキャッシュしている**（`cardCache`, TTL 付き）。
宛先の役割で中身を変えると、**先に staff 宛で温まったキャッシュが参加者にそのまま配られる**。

したがって、リマインダーメールは `listByEvent(id, "public")` に固定する。
スタッフ宛のリマインダーに裏方を載せたくなったら、
**キャッシュのキーに役割を入れるところから**別 issue で設計する（10. に置く）。

### 5.4 「そもそも取らない」を残りの経路にも

- 経路 7（`PATCH .../:itemId/material`）… 対象を引く `findItem` にも `audience` を足し、
  このルートは**常に `"public"`** で引く。裏方の項目は**引けない**ので 404 になる。
  「引いてから弾く」にしない。裏方に登壇資料は要らないので機能の損失も無い
  （staff も裏方の資料URLをここからは触れないが、編集画面の全体保存では触れる）。

  **副作用として、未割り当て（ネタ出し中）の項目もここから編集できなくなる**
  （`publicItemWhere` が2つの軸をまとめて見るため）。いまの振る舞いからの変化だが、
  未割り当ては参加者に見えない＝登壇資料を出す先が無いので実害は無いと見た。
  配置すれば従来どおり編集できる
- 経路 8（`listNeedingOgRefresh`）… 同じく `publicItemWhere` 付きにする。
  裏方の URL を外部ホストへ取りに行かない。要らない通信を増やさない

---

## 6. API の変更

**新しいエンドポイントは作らない。** `GET /api/events/:id/timetable` 1本のまま。

- スタッフ専用の `GET /:id/timetable/staff` を足すと、**どちらを叩くかの判断が画面側に移る**。
  いまの1本は「見える人には見える形で返る」形で、画面は
  「来たものをそのまま描く」だけで済んでいる（`EventSchedule.tsx:66` と
  `EventMaterials.tsx:28` のコメントがまさにそう書いてある）。この形を崩さない
- #384（役割タグ）が乗るときも同じ1本に乗る

### 6.1 レスポンス

`ScheduleItem` に `visibility` を、`EventTrack` に `visibility` を足す。
`audience: "public"` で取った結果は**必ず全部 `'public'`** になる
（値そのものは返してよい。「見えている項目が表か裏か」は staff の画面が必要とする）。

### 6.2 保存 `PUT /api/events/:id/timetable`

`saveScheduleItemInput` に `visibility`、`saveScheduleTrackInput` に `visibility` を足す。

~~どちらも `.default("public")`（`placement` の既定と同じ考え方）~~
→ **どちらも `.optional()`。省略は「いまの値を保つ」。** 既定値 `'public'` は
**古いクライアントからの保存で裏方を全件公開にする**（4.2 の規則4。実装中に判明）。
既定が裏方だと既存クライアントの項目が黙って消える、という当初の心配は
「省略＝保つ」なら起きない（新規の項目・列だけ `'public'` から始める）。

保存は staff 限定（`requireEventRole(["staff"])`）なので、参加者が裏方を消したり
覗いたりする経路にはならない。ただし 5.2 のとおり
**「staff として読めた人」と「保存が通る人」が同じ関数で決まる**ことが要る。
ずれていると、公開向けに絞られた一覧を受け取った人が保存でき、
その差分保存で**裏方が全部消える**（0067 の未割り当てで同じ事故が想定されていて、
`canEditTimetable` のコメントがそれを書いている）。

### 6.3 `GET /:id/timetable/editing`（編集中の表示）

変更なし。もともと編集できる人にしか返らない。

---

## 7. 画面の変更（**相談済み・決定**）

決まったこと: 編集は **案E3**、表示は **案V1 と案V2 の両方**、色は **7.3 のとおり直す**、
導線 (7.4) は**公開トラックの本数**で判断する。


### 7.1 編集

- **案E1 … 1つの表に混ぜ、行ごとに「スタッフのみ」のトグル。**
  トラック選択欄にスタッフ用トラックも並ぶ。
  利点: 表のセッションの隣に準備が並ぶ＝連動が目で見える（要件そのもの）。
  欠点: 参加者向けの表が裏方で埋まって読みにくい。
  `ScheduleEditor.tsx` は 418 行、`ScheduleItemRow.tsx` は 331 行あり、行が増える
- **案E2 … 「表」「裏方」をタブで分ける。**
  欠点: **時間軸が分かれて見える。** 要件（時間軸が揃っていないと使えない）に正面から反する。
  採らない方向で相談したい
- **案E3（推し） … 1つの表のまま、裏方の行は薄い背景＋鍵アイコン。既定は折りたたみ**
  （「裏方 3件を表示」）。既定で邪魔にならず、開けば同じ時間軸に並ぶ。
  いまの「未割り当て」の行が別の塊で下に並んでいる作り（`ScheduleEditor.tsx:266`）と相性が良い

### 7.2 表示

- **案V1 … `EventTimetablePage`（トラック別の格子）に、staff にはスタッフ用トラックの列を足す。**
  裏方の項目は、載っている公開トラックの列にも半透明の帯として重なる。
  「どのトラックの裏方か」が一目で分かる。要件に最も近い
- **案V2 … イベント詳細の `EventSchedule`（時刻順の一覧）に、鍵付きの行として混ぜる。**
  実装が小さいが、どの列の裏方かは印（チップ）でしか分からない
- 案V1 と案V2 は**両立する**。サーバーが返すのは1本なので、どちらも
  「来たものをそのまま描く」で済む。いまの `unassignedChip` と同じ形で
  `staffOnlyChip` を足すのが最小

### 7.3 色（相談ではなく決め事にしたい点）

`apps/web/src/lib/trackColors.ts` は**トラックの本数から色を作る**。
スタッフ用トラックを本数に混ぜると、**公開トラックの色が変わる**
（参加者の画面と staff の画面で、同じトラックが別の色になる）。
会場で「青の列」と口頭で伝えている運営が壊れる。

→ 色は**公開トラックの本数だけ**で作り、スタッフ用トラックは共通の無彩色＋斜線にする。

### 7.4 導線

`EventSchedule.tsx:104` の「トラック別に見る」は `tracks.length >= 2` で出す。
この判定も**公開トラックの本数**で行う。スタッフ用トラックを1本足しただけで
staff にだけ導線が生える／消えるのは分かりにくい。**7. の相談点に入れる**
（「スタッフ用トラックがあるなら staff には出したい」という考え方もある）。

### 7.5 文言

`packages/shared/src/i18n/messages/schedule.ts` に足す（`ja` / `en` の2つ）。
運営専用の操作画面の文言は `staffOps.ts` が持つが、
今回はタイムテーブルの中に混ざる語なので `schedule.ts` に置く。
**「スタッフ」「裏方」の語は利用者向けの言い回しに寄せる**（実装上の列名を出さない）。

---

## 8. 既存データへの影響

- 既存のトラックは全部 `visibility = 'public'`。**見え方は変わらない**
- 既存の項目は全部 `visibility = 'public'`。**見え方は変わらない**
- `idx_schedule_placement` を落として `idx_schedule_visible` に張り替える。
  同じ用途の索引を2本持たない
- 参加者向けの取得の `WHERE` が1条件増える。イベント単位の取得なので実測の差は出ない見込み
- リマインダーメールの `cardCache` は中身が変わらないので、
  デプロイ直後の温まり直しだけ（TTL 内）
- 公開プロフィールの「登壇したイベント」（経路 6）は、**いまと同じ結果**になる
  （既存の項目は全部 `'public'` のため）
- **「登壇 N 回」の数字は減ることがある**（経路 10〜13）。
  未割り当て（ネタ出し中）のコマの担当に指名されている人は、いま数に入っている。
  5.1 で条件を足すと数から外れる。**これは 0067 が意図していた状態への修正**
  （経路 6 だけ直っていて他が直っていなかった）で、退行ではない。
  影響は「ネタ出し中のコマに担当が入っているイベント」に限られる。
  適用前に件数を数えておくこと:
  ```sql
  SELECT COUNT(DISTINCT si.speaker_user_id) FROM event_schedule_item si
   WHERE si.speaker_user_id IS NOT NULL AND si.placement = 'unassigned';
  ```
  数が大きい（＝ネタ出し中に担当まで入れる運用が定着している）なら、
  この修正だけ別 PR に切って先に入れる。本設計の残りとは独立している

---

## 9. テストで確かめること

新規 `apps/server/test/staff-timeline.test.ts`。
既存の `schedule-tracks.test.ts` は 628 行あるので足さない（1ファイル800行）。

**「参加者に漏れない」は経路ごとに1つずつ確かめる。** 2.2 の表と1対1で対応させる。

### 9.1 経路 1・2・3・4 — 参加者向けの API に裏方が1件も入らない

同じ1本の API なので1つのテストで4経路を押さえる（フロントは全部この hook 1本）。

1. staff で保存: 公開トラックA・スタッフ用トラックS、
   公開セッション2件、裏方（トラックA）1件、裏方（トラックS）1件、未割り当て1件
2. 参加者として `GET /:id/timetable` を取る
3. `items` に裏方の ID が1件も無い。**タイトル文字列でも照合する**
   （`id` だけだと、将来「id は返すが中身は伏せる」形にしたとき通ってしまう）
4. `tracks` にスタッフ用トラックの ID が無い
5. `items[*].trackIds` にスタッフ用トラックの ID が1つも無い（5.1 の JOIN の担保）
6. staff で取ると全部返る

### 9.2 経路 1 — 参加者と staff で、**公開セッションの時刻が一致する**（3.3 の証拠）

トラックAに「開会 10:00(10分)」「裏方（30分）」「発表（60分）」を順に置く。

- staff の `computeScheduleTimes` と参加者のそれで、**「開会」と「発表」の時刻が同じ**
- 3.3 を実装しないとここで落ちる（参加者側の「発表」が 20 分早くなる）
- `placement = 'all'` の裏方でも同じことを確かめる（全カーソルを進めてしまう経路）
- スタッフ用トラックを `computeScheduleTimes` の列に混ぜても
  `all` の時刻が動かないこと（3.3 の後半）

### 9.3 経路 5 — リマインダーメールの本文に裏方が出ない

`buildEventExtraHtml(link, true)` を直接呼ぶ。
`schedule-tracks.test.ts:572` が未割り当てについて同じ形で確かめているので、それに揃える。

- 返る HTML に裏方のタイトルが**含まれない**
- 公開セッションの時刻表記が 9.2 と同じ（メールも同じ計算を通る）
- **キャッシュを跨いでも変わらない**: 同じイベントで2回呼び、2回とも裏方が出ない

### 9.4 経路 6 — 公開プロフィールの登壇イベントに出ない

`schedule-tracks.test.ts:594`（未割り当ての同種のテスト）に揃える。

裏方の項目にだけ `speaker_user_id` を入れたイベントを1つ作り、
`listPublicSpokenEventIds` がそのイベント ID を返さないこと。
公開セッションで登壇しているイベントは返ること（絞りすぎていないことの確認）。

### 9.5 経路 7 — 裏方の資料URLは本人でも編集できない

裏方の項目の `speaker_user_id` に参加者を入れ、その本人で
`PATCH /:id/timetable/:itemId/material` を叩いて 404。
公開セッションでは従来どおり通ること。

### 9.6 経路 8 — OG メタの取得対象に裏方が入らない

裏方の項目に `material_url` を入れ、`listNeedingOgRefresh` が返さないこと。

### 9.7 経路 10〜13 — 「登壇 N 回」に数えない

裏方の項目にだけ担当としてリンクされた人を作り、次の4つが**増えないこと**を1つずつ確かめる。
1つのテストにまとめない（4つとも別の SQL で、片方だけ直っていた事故が実際に起きている）。

- 公開プロフィールの参加実績 (`eventMembers.ts` の `spoken`)
- 名刺（イベント内）の `spoken` (`nameCards.ts:87`)
- 名刺（終了済み公開イベント）の `spoken` (`nameCards.ts:163`)
- ゲーミフィケーションの `spoken` (`gamification.ts:47`)

**未割り当てでも増えないこと**を同じテストで確かめる（8. の既存不具合の修正の証拠）。

### 9.8 経路 9（保存）— 4.2 の正規化

- スタッフ用トラックにだけ載せた `visibility = 'public'` の項目が、
  保存後に `'staff'` へ格上げされている
- 公開トラックに載せた `visibility = 'staff'` の項目は**そのまま**（要件 2）
- 参加者が `PUT` を叩くと 403（既存の担保の退行防止）

### 9.9 トラックを消したとき（0067 の規則が効き続ける）

スタッフ用トラックを消すと、そこにしか載っていなかった裏方が `unassigned` に落ち、
`visibility` は `'staff'` のまま。参加者には**二重に**返らない。

### 9.10 新しい経路が増えたときに気づく仕掛け（`staff-timeline-sql-audit.test.ts`）

`audience` を必須引数にすれば、`listByEvent` / `listTracks` の**新しい呼び出し元**は
コンパイルエラーで気づける。しかし **`event_schedule_item` を直に読む新しい SQL** は
型では防げない（経路 6・7・8 が実際にその形だった）。

そこで、`apps/server/src/` を読み、`event_schedule_item` を `FROM` / `JOIN` に持つ
SQL 文字列を抽出して、`visibility` を参照していないものを列挙するテストを1本置く。
許可リストで例外を明示する（書き込み系、staff 専用系、`listIds` のような ID だけ引くもの）。
許可リストには**なぜ見なくてよいかを1行ずつ書く**。

`notification-actor.md` の「二重管理は照合を実在させる」と同じ発想で、
「コメントに『ここも直すこと』と書く」を実行可能な形にしたもの。

**このテストは実際に効く。** 経路 10〜13 は、
0067 が経路 6 のコメントに「ここでも数えない」と書いた**あとに**書かれた／見落とされた
4か所で、コメントでは防げなかった。同じ形の見落としを次から機械が捕まえる。

### 9.11 フロント

`apps/web` 側は「来たものをそのまま描く」なので、
**絞り込みのテストは書かない**（書くと 2.3 の重複を復活させる）。
書くのは表示のテストだけ:

- 裏方の行に印が出る（`Timetable.test.tsx` / `EventSchedule.test.tsx` に1件ずつ）
- スタッフ用トラックが混ざっても**公開トラックの色が変わらない**（7.3。`trackColors` の単体テスト）
- `ScheduleEditor.test.tsx` に「スタッフのみ」を切り替えると
  送られる `visibility` が変わることを1件

---

## 10. やらないこと（範囲の線引き）

- **#384 の役割タグ・必要人数・スタッフの割り当ては作らない。**
  本 PR は「裏方の項目を置ける土台」まで。
  役割を当てる先（時間帯を持つ項目）ができれば #384 は乗る。
  `event_schedule_item` に `role` や `required_count` のような列を**先回りして足さない**。
  裏方の項目に「担当者」を1人リンクすること自体は、既存の `speaker_user_id` で
  いまも書ける（表示は「担当」）。**複数人・人数・役割は #384 の仕事**で、
  本 PR では `speaker_user_id` の意味を広げない
- **スタッフ宛のリマインダーメールに裏方を載せない。** 5.3 のとおり
  `buildEventExtraHtml` のキャッシュが宛先の役割を持っていない。
  やるならキャッシュのキーの設計から。別 issue
- **「参加者に一部だけ見せる」を作らない。** たとえば撤収の開始時刻だけ知らせたい、など。
  `visibility` が3値以上になると、4.1 の許可リストの利点が薄れる。
  必要になったら「公開セッションとして書く」で足りる
- **チェックリスト・持ち物・当日の進行メモを付けない。** 項目の中身を増やす話は別
- **裏方の項目に通知・リマインダーを飛ばさない**（「10分後に撤収です」など）。
  cron の枠は埋まっている（メール構成の制約）ので、載せる先の設計から要る
- **スタッフ用トラックを会場の部屋に紐づけない。** 0067 と同じ範囲外 (#338)
- **権限の粒度を増やさない。** 「staff なら見える / それ以外は見えない」の2値だけ。
  「特定のスタッフにだけ見せる」は作らない
- **監査ログを足さない。** 裏方の閲覧・編集は既存のタイムテーブル編集と同じ扱い
- **既存の `placement` の値は増やさない・減らさない**（3.2 案A）

---

## 11. 変更するファイル

| ファイル | 変更 |
|---|---|
| `apps/server/migrations/0072_staff_timeline.sql` | **新規**（2列・索引の張り替え） |
| `apps/server/src/db/repositories/eventSchedule.ts` | `audience` を必須引数に、`publicItemWhere`、`listByEvent` / `listTracks` / 対応表 JOIN / `findItem` / `listPublicSpokenEventIds` / `listNeedingOgRefresh`、保存時の正規化（4.2） |
| `apps/server/src/routes/eventSchedule.ts` | `canEditTimetable` を削除して `canManageEvent` に寄せる、`audience` の決定1か所、`filter` の削除、`PATCH material` の対象を public 限定 |
| `apps/server/src/auth/roles.ts` | `Context` から引く薄い包みを1つ足す |
| `apps/server/src/lib/email.ts` | `listByEvent(id, "public")` に変え、`filter` を削除 |
| `apps/server/src/db/repositories/eventMembers.ts` | `spoken` の SQL に `publicItemWhere("si")`（経路 10） |
| `apps/server/src/db/repositories/nameCards.ts` | `spoken` の SQL 2本に同じ（経路 11・12） |
| `apps/server/src/db/repositories/gamification.ts` | `spoken` の SQL に同じ（経路 13） |
| `packages/shared/src/eventSchedule.ts` | `scheduleVisibilitySchema`、`ScheduleAudience`、`ScheduleItem` / `EventTrack` / 保存入力に `visibility`、`computeScheduleTimes` の1行（3.3）、`findTrackOverlaps` の扱い |
| `packages/shared/src/i18n/messages/schedule.ts` | 文言（`ja` / `en`） |
| `apps/web/src/components/ScheduleEditor.tsx` / `ScheduleItemRow.tsx` / `scheduleEditorModel.ts` | 編集（7.1 で決めた案） |
| `apps/web/src/components/EventSchedule.tsx` | 裏方の印（7.2 案V2） |
| `apps/web/src/lib/timetableLayout.ts` / `components/TimetableGrid.tsx` / `TimetableTrackTabs.tsx` | 格子（7.2 案V1） |
| `apps/web/src/lib/trackColors.ts` | 公開トラックの本数で色を作る（7.3） |
| `apps/server/test/staff-timeline.test.ts` | **新規**（9.1〜9.9） |
| `apps/server/test/staff-timeline-sql-audit.test.ts` | **新規**（9.10） |
| `apps/web/src/components/*.test.tsx` ほか | 9.11 |

新しい依存は無し。既存ファイルはいずれも 800 行を超えない
（最大は `ScheduleEditor.tsx` の 418 行）。

---

## 12. 実装の順番

1. `0072` と `packages/shared` の型（`visibility` を持つが、まだ誰も使わない）
2. `computeScheduleTimes` の 3.3 と、その単体テスト（9.2 の土台）。
   **ここが先**。あとから足すと、絞り込みを入れた瞬間に時刻がずれる
3. リポジトリの `audience` 必須化。**この時点で全呼び出し元がコンパイルエラーになる**ので、
   2.2 の表と突き合わせて1つずつ埋める。
   `publicItemWhere` の `export` と、経路 10〜13 の4本の SQL もここで直す
   （8. の件数次第では、この4本だけ先に別 PR）
4. ルート・メールの `filter` 削除、`canManageEvent` への一本化
5. 9.1〜9.10（**画面より先**。漏れの担保はサーバーだけで完結させる）
6. 保存入力と 4.2 の正規化
7. 画面（7. の相談で決めた案）
