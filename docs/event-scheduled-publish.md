# イベントの予約公開（D-EVENT-SCHEDULED-PUBLISH）

オーナー依頼：「イベントの予約公開機能が欲しいです」

下書きのイベントに「公開する日時」を入れておくと、その時刻になったら自動で公開されるようにする。
この文書は設計の正本で、実装の前にオーナーの承認を取る。基準にしたのは main `292bfae`。

---

## 1. 要件

### 1.1 やること

- 下書きのイベントに、公開予定の日時を設定・変更・取り消しできるようにする。
- その時刻を過ぎたら、イベントを自動で「公開」にする。手動の「公開する」と同じ通知を、**ちょうど1回だけ**送る。
- 予約中は、運営の画面に「○月○日 HH:mm に公開予定」と出す。
- 予約中でも「今すぐ公開」はでき、押すと予約は消える。

### 1.2 やらないこと

- **作成画面で予約を入れること**：作成は今まで通り必ず下書きで始まり、予約は編集画面で入れる。→ 未決事項 Q2
- **予約の非公開化**（公開中のイベントを、決めた時刻に下書きに戻すこと）。
- **複数の予約や履歴**：予約は1件で、上書きするだけ。
- **秒単位の正確さ**：最大で約1分、遅れることがある（§3.3）。
- **公開時の新しい通知種別、メール、Nostr への投稿**：今の「公開時の通知」と同じものだけを送る。
- **予約したアカウントがあとで消えた場合などの特別扱い**：§5.6 を参照。

---

## 2. 今の仕組み（調べた事実）

### 2.1 公開状態

- `event.status` は `draft` / `published` / `archived` のどれか（`packages/shared/src/constants.ts`）。`event.visibility` の `public` / `unlisted` / `private` とは別の値。
- 公開になる経路は2つある。
  - `PATCH /api/events/:id` に `status: "published"` を送る（編集画面のトグル）
  - `POST /api/events/:id/publish`（運営ページの下書き警告にある「公開する」）
- どちらもイベントの staff が使える（`requireEventRole(["staff"])`）。
  - リポジトリ側では、`activeManagerSql` で「退会していない管理者か」を確かめる。管理者は event staff、コミュニティの owner/admin、アプリ管理者のどれか。
- 状態が変わると `access_revision` が1増える（`eventsRepo.update` / `setStatus`）。
- 作成は必ず `draft` で始まる。複製（`eventDuplicate.ts`）も同じ。

### 2.2 公開になったときに起きること

`eventCrud.ts` の `notifyOnPublish(prior, event)` が、上の2つの経路の両方から呼ばれる。

| やること | 1回だけにする仕組み |
|---|---|
| `notifyRequestsOnPublish`：イベントに紐づいた「たまご」の賛同者へ通知する | `event_request_event.notified_at = 0` の行だけを対象にし、送ったら `markNotified` で印を付ける |
| `notifyFollowersOnPublish`：作成者のフォロワーへ「イベントを公開しました」と知らせる。公開範囲が `public` のときだけで、メールもあり | `claimFollowersNotify`。`followers_notified_at = 0` を `UPDATE` で取り合うので、何度呼ばれても送るのは1回 |
| PATCH の経路でだけ：`settingsSignalTargets` が `status` の変化を見て、`["live", id]` の「取り直して」シグナルを出す（D-POLL-MIN） | 1回だけにする仕組みは無い（何度出しても害はない） |

ほかに調べたもの：

- **作らずに済んでいる仕組み**：サイトマップは無い。Nostr へのイベント投稿も無い。
- **リクエストのたびに作るので、公開になれば自動で変わるもの**：
  - OGP。`worker.ts` が `/events/:id` を返すとき、`status === "published"` を見て差し込む
  - フィード（RSS / JSON / iCal）
  - 検索・一覧・コミュニティ・ユーザーページ・KPI。どれも `status = 'published'` で絞っている（約60か所）
- **キャッシュ**：フィードは `private, no-store`、イベントの API と HTML も `private, no-store` なので、エッジに古い状態は残らない。

### 2.3 公開状態で絞っている読み取り

- `eventViewSql`（`auth/eventAccess.ts`）：公開済みで、公開範囲が public か unlisted なら誰でも見られる。下書きは、管理者・参加者・招待された人だけ。
- 一覧と検索（`events.ts` の `listPublished` / upcoming / past / scheduling / discovery）、コミュニティ（`communities.ts`）、プロフィール（`eventMembers.ts`, `nameCards.ts`）、表彰・ランキング・KPI など、`status = 'published'` を直接書いている箇所が多い。

→ 公開時刻を読み取りのたびに判定する方式にすると、これら全部を書き換えることになる。

### 2.4 定期実行

- `worker.ts` に `scheduled()` はあるが、wrangler.toml に `[triggers]` が無く、**eventer の Worker に cron は付いていない**。
  - Cloudflare の API で確かめたところ、アカウントの cron 枠5個はほかのプロジェクトで埋まっている（aozoraquest-edge×2、kuda、noscha-io×2）。
  - handover にも「Workers の cron 枠が上限なので GitHub Actions から叩く」とある。
- 定期実行は GitHub Actions から `POST /api/cron/*` を `x-cron-key` 付きで呼んでいる（`reminders.yml`、`broadcast-emails.yml`、ほか）。
- **ただし `broadcast-emails.yml` の `*/5 * * * *` は、実際には 2.7〜9.8 時間おき（中央値 5.7 時間）にしか動いていない**。2026-10-04〜13 の直近40回の実測で、公開リポジトリの schedule が間引かれているため。
  - したがって GitHub Actions は、「予定した時刻に公開する」用途には使えない。

### 2.5 D-POLL-MIN の制約

- ブラウザから定期的に問い合わせない（`setInterval` は使わない。`noPolling.test.ts` で確かめている）。
- 新しい定期読み取りで D1 の読み取り行数を増やさない。

---

## 3. 方式

### 3.1 案の比較

| 案 | 中身 | 判断 |
|---|---|---|
| (a) 読み取り時に判定 | `status='published' OR (status='draft' AND publish_at<=now)` を、2.3 の全部の読み取りに入れる。通知は別に起こす必要がある | **採らない**。約60か所の SQL と `eventViewSql` を書き換えることになり、漏れたところで「見えるのに一覧に出ない」「通知が来ない」が起きる。それに、通知を起こすきっかけは結局どこかに要る |
| (b) 数分おきの cron で状態を切り替える | 定期実行で `draft` を `published` に変え、通知も送る | **今の環境では成り立たない**。Workers の cron 枠はアカウントで埋まっていて、GitHub Actions は数時間遅れる（2.4） |
| (c) **リクエストをきっかけに切り替える（推奨）** | Worker が受けたリクエストの最初に「公開時刻を過ぎた下書き」を `published` に切り替え、通知を送る。1つの isolate では最大1分に1回だけ確かめる | **推奨**。状態は今の `status` のままなので、2.3 の読み取りは1行も変えなくてよい。通知も、既存の1回だけにする仕組みで済む |

(c) は、(b) の「状態を切り替えて通知する」を、タイマーではなく**届いたリクエスト**で動かすものと言える。

- Durable Object の alarm や Queues の遅延配信も時刻ちょうどに動かせるが、これまでの方針「KV / DO を入れない」と、仕組みの最小化に反するので採らない。
- オーナーが cron 枠を1つ空けられる場合は (b) も選べる。→ 未決事項 Q1

### 3.2 データ

migration **0111** で列と索引を足す。

```sql
-- 0111_event_publish_at.sql
ALTER TABLE event ADD COLUMN publish_at INTEGER;  -- epoch ms。NULL = 予約なし
CREATE INDEX idx_event_publish_at ON event(publish_at) WHERE publish_at IS NOT NULL;
```

守ること：

- **I1**：`publish_at IS NOT NULL` のとき、`status = 'draft'`。公開になった時点で必ず NULL に戻し、予約が残ったままの公開イベントを作らない。
- **I2**：`publish_at` を設定・変更するときは、`publish_at > now` でなければならない（サーバーで確かめる）。
- **I3**：状態が `draft` から `published` に変わるのは、1つのイベントにつき1つの文だけ。通知は、その文で実際に行を変えた側だけが送る。

使い方：

- 共通の型 `eventSchema` に `publishAt: z.number().nullable()` を足す。
  - 下書きを見られるのは管理者・参加者・招待された人だけなので、予定時刻を見せても問題はない。
- `updateEventInput` に `publishAt: z.number().int().positive().nullable().optional()` を足す。
- 作成と複製では `publish_at` を入れない（NULL のまま）。

### 3.3 切り替えの処理

`apps/server/src/lib/scheduledPublish.ts` を新しく作る。

```ts
let lastDueCheckAt = 0;                    // isolate ごと。タイマーではない
const DUE_CHECK_INTERVAL_MS = 60_000;

export async function publishDueEvents(now = Date.now()): Promise<void> {
  if (now - lastDueCheckAt < DUE_CHECK_INTERVAL_MS) return;
  lastDueCheckAt = now;
  const rows = await many<{ id: string }>(
    `UPDATE event SET status='published', publish_at=NULL, access_revision=access_revision+1
      WHERE status='draft' AND publish_at IS NOT NULL AND publish_at<=?
      RETURNING id`, now);
  if (rows.length === 0) return;
  await deferBackground(runPublishSideEffects(rows.map(r => r.id)));
}
```

- **呼ぶ場所**：`worker.ts` の `app.use("*")` の先頭近くで呼ぶ。`/api/*` と、イベントの HTML の経路（`/events/:id`、`/e/:slug`）だけを対象にする。
  - 対象のリクエストでは、間引きの判定のあとに `UPDATE` を**待ってから**、そのリクエストを処理する。だから、時刻を過ぎて最初に確かめたリクエストは、もう公開済みの状態を見る。
  - 通知は `deferBackground`（waitUntil）に回し、レスポンスを待たせない。
- **`runPublishSideEffects(ids)`**：イベントごとに `findById` で読み直して、`notifyOnPublish(prior, event)` を呼ぶ。
  - `prior` には `{ ...event, status: "draft" }` を渡す。
  - そのうえで `eventSignal.publishRefetch([["live", id]])` を出す。PATCH で公開したときと同じシグナル。
  - `notifyOnPublish` は eventCrud.ts から lib に移し、手動・自動の両方が同じ関数を使う。中身は変えない。
- **遅れ**：最大で「公開時刻から、次にどこかの isolate がリクエストを受けて確かめるまで」。
  - 通常は1分以内。
  - サイトに誰もアクセスしない時間帯は、最初のアクセスまで公開（とフォロワーへの通知）が遅れる。ただ、その間はそもそも誰も見ていない。
- **D1 のコスト**：部分索引を引くだけなので、該当が0件なら読み取りはほぼ0行。
  - 1つの isolate で1分に1回なので、全体で「isolate の数 ÷ 1分」の小さな書き込みクエリが増えるだけ。
  - D-POLL-MIN で減らした量（数百行/時）に対して、誤差の範囲。
  - ブラウザからの問い合わせは増えない。

### 3.4 1回だけを守る仕組み

- `UPDATE … WHERE status='draft' AND publish_at<=? RETURNING id` は1つの文で原子的に動く。
  - 2つの isolate が同時に動いても、行を変えた側だけが id を受け取る。
  - だから `runPublishSideEffects` が同じイベントで2回動くことはない。
- 手動の公開（PATCH・POST /publish）は、同じ UPDATE の中で `publish_at = NULL` に戻す。
  - 手動で公開した後は、自動の切り替えの条件（`status='draft'`）に当たらない。
- フォロワーへの通知は、これまで通り `claimFollowersNotify` で1回だけになる。
  - 公開 → 下書き → 再び予約 → 自動公開、と進んでも、2回目は送らない（今の手動公開と同じ）。

---

## 4. 画面

予約公開を入れるのは編集画面だけ。運営ページと詳細ページには表示を足す。

### 4.1 編集画面（`EditEventPage.tsx`）

「公開状態」のトグルを3択にする。

```
公開状態
[ 非公開（下書き） ][ 予約公開 ][ 公開 ]
 公開する日時 [ 2026-10-20 12:00 ]   ← 「予約公開」を選んだときだけ出す
 この日時になると自動で公開され、フォロワーに通知されます。
```

- 日時は `type="datetime-local"` で入れる。締切日時と同じ部品と変換（`toLocalInput` / `fromDateTimeLocal`）を使う。
  - 時刻はブラウザの地域時間で、日本なら JST。今の開催日時・締切と同じ扱い。
- 送る内容：
  - 予約公開：`status: "draft", publishAt: ms`
  - 下書き：`status: "draft", publishAt: null`
  - 公開：`status: "published"`。`publishAt` は送らず、サーバーが NULL に戻す
- 過去の日時を選んだときは、保存ボタンの手前で「未来の日時を入れてください」と出して、保存させない。
  - サーバーも 400 `publish_at_past` を返す。
  - 「すぐ公開したいなら『公開』を選ぶ」という扱いで、過去の日時を自動で即公開にはしない。

### 4.2 運営ページ（`EventManagePage.tsx`）

下書きの警告（今の `draftNotice`）を、予約の有無で出し分ける。

- 予約なし：今のまま。「このイベントは下書きです…［公開する］」
- 予約あり：「このイベントは **10/20 12:00** に自動で公開されます。それまでは他の人には表示されません。」とし、［今すぐ公開］［予約を取り消す］を並べる。
  - 今すぐ公開：今の `POST /publish`。予約は自動で消える。
  - 予約を取り消す：`PATCH { publishAt: null, expectedAccessRevision }`。

### 4.3 詳細ページ・一覧

- 詳細ページの見出しにある状態チップ（今は `draft` と出る）を、予約中は「公開予定 10/20 12:00」に変える。
- 一覧カードの `DraftChip`（下書き）はそのまま。予約中でも下書きであることに変わりはないので、増やさない。

### 4.4 時刻を過ぎたあとに画面を開いていた場合

- 確認のための問い合わせはしない（D-POLL-MIN）。
- 運営ページや詳細ページを開いたままでも表示は「予約中」のままで、再読み込みで「公開」になる。
- 配信画面だけは、`live` シグナルで取り直される（PATCH で公開したときと同じ）。

---

## 5. 場合ごとの振る舞い

### 5.1 時刻の変更・取り消し

- 予約中なら、何度でも時刻を変えたり取り消したりできる。
- 自動の切り替えと同時に保存した場合は §5.5。

### 5.2 予約中に手動で公開した場合

- `publish_at = NULL` にして、すぐ公開する。通知は今の手動公開と同じで、1回だけ。

### 5.3 公開後に下書きへ戻した場合

- 今と同じ。予約は I1 によりもう無い。
- 改めて予約を入れられて、そのときもフォロワーへの通知は再送しない（`followers_notified_at`）。

### 5.4 過去の時刻を入れた場合

- 400 `publish_at_past` を返し、保存しない（I2）。
- `archived` のイベントや、`status: "published"` と一緒に `publishAt` を送った場合も 400 `publish_at_invalid`。

### 5.5 編集フォームが古いまま保存された場合（重要）

今の編集フォームは、保存のたびに `status` を送っている。何もしないと、次のように取り消しが起きてしまう。

1. 下書きのときにフォームを開く。
2. その間に、自動で公開される。
3. 古いフォームのまま保存すると、`status: "draft"` が送られる。
4. **公開したばかりのイベントが、黙って下書きに戻ってしまう。**

これを防ぐため、サーバーで次のように確かめる。

- 送られてきた `status` か `publishAt` が今の値と違うときは、`expectedAccessRevision === 今の accessRevision` を必須にする。合わなければ 409 `publish_state_changed` を返す。
  - 自動の切り替えでは `access_revision` が増える。だから古いフォームは必ず弾かれる。
- 編集フォームは、公開状態か予約日時を読み込み時から変えた場合は、`expectedAccessRevision: formRevision` を送る。
  - 古いフォームは「変えていない」つもりで送るが、サーバーから見ると値が違う。revision も付いていないので、やはり 409 になる。
- 409 を受けたら、今の日時変更と同じように読み直して、「ほかの変更で状態が変わりました」と出す（既存の `schedule.changed` の文言を使う）。
- `eventsRepo.update` の UPDATE には、すでに `e.access_revision = ?` の条件がある。そのため、読み直しから UPDATE までの間に切り替えが起きた場合も、その UPDATE が失敗して 409 になる。

取り消しと自動公開が同時に起きた場合：

- 先に自動公開が行を変えれば、取り消しは 409 になる。その後に再読み込みすると「公開」と表示されるので、必要なら下書きに戻す。
- 通知はもう送られていて、取り消せない。これは時刻ちょうどに取り消そうとした場合だけで、受け入れる。

### 5.6 公開範囲・コミュニティ・作成者

- **限定公開（unlisted）・非公開（private）**：予約できる。時刻になると、リンクを知っている人や招待された人が見られるようになる。フォロワーへの通知は、今の手動公開と同じく `public` のときだけ。
- **コミュニティのイベント**：時刻になると、コミュニティの一覧や数字に入る（`status` で絞っているので、何もしなくてよい）。紐づけるときの権限は、予約を保存するときに今の `canAttachCommunity` で確かめている。
- **作成者や管理者がいなくなった場合**：自動の切り替えでは管理者の確認をしない。予約を入れた時点で、管理者が公開を決めたと扱う。予約した人が退会してもイベントは消えないので（今の退会と同じ）、予定どおり公開する。止めたい場合は、残っている管理者が取り消す。

---

## 6. 変更する箇所

| 層 | ファイル | 変更 |
|---|---|---|
| migration | `apps/server/migrations/0111_event_publish_at.sql` | 列と部分索引を足す（§3.2） |
| 共通 | `packages/shared/src/schema.ts` | `eventSchema.publishAt`、`updateEventInput.publishAt` |
| 共通 | `packages/shared/src/i18n/messages/eventForm.ts`, `eventDetail.ts` | 「予約公開」「公開する日時」「公開予定」「今すぐ公開」「予約を取り消す」の文言（日本語・英語） |
| サーバー | `db/repositories/events.ts` | `toEvent` に `publishAt` を足す。`update` で `publish_at` を書き、`status='published'` なら NULL に戻す。`setStatus("published")` でも NULL に戻す |
| サーバー | `routes/eventCrud.ts` | §5.4 と §5.5 の確認を足す。`notifyOnPublish` を lib に移す |
| サーバー | `lib/scheduledPublish.ts`（新規） | `publishDueEvents`, `runPublishSideEffects` |
| サーバー | `worker.ts` | 対象の経路の先頭で `publishDueEvents()` を呼ぶ |
| web | `pages/EditEventPage.tsx` | 3択のトグル、日時の入力、`expectedAccessRevision` の付け方 |
| web | `pages/EventManagePage.tsx` | 予約中の警告と、2つのボタン |
| web | `pages/EventDetailPage.tsx` | 「公開予定」のチップ |

テストで列名を並べている箇所（`PRAGMA table_info(event)` を使うもの）は、実装時に必要なら直す。

---

## 7. ステージングでの確かめ方

- ステージングにも同じ migration 0111 を当てる（本番の前に、手で）。
- ステージングには入口のゲートがあるが、管理者として入れば編集画面・運営ページは本番と同じように使える。
- 自動の切り替えはリクエストで動くので、ステージングで cron が止まっていても関係なく確かめられる。

確かめる手順：

1. テスト用の下書きイベントで、**今から2〜3分後**に予約公開を入れて保存する。運営ページに「HH:mm に自動で公開されます」と出ることを確かめる。
2. そのイベントに関わっていない別の管理者以外のアカウントでは、時刻前に開くと 404 になることを確かめる。ステージングは入口のゲートで未ログインでは開けないため、ゲートを通るアカウントで見る。未ログインで見えるかどうかは自動テストで確かめる。
3. 時刻を過ぎてから、何かのページを開いて1分ほど待ち、再読み込みする。状態が「公開」になり、一覧にも出ることを確かめる。
4. テスト用のアカウントで作成者をフォローしておき、「イベントを公開しました」の通知が**1件だけ**届くことを確かめる。
5. もう1件予約を入れて取り消し、時刻を過ぎても公開されないことを確かめる。
6. もう1件予約を入れて「今すぐ公開」を押し、すぐ公開され、時刻が来ても通知が増えないことを確かめる。
7. D1 の insights で、切り替えの UPDATE の読み取り行数がほぼ0であることを確かめる。

注意：

- ステージングの D1 にあるフォロワーへの通知とメールは、手動で公開したときと同じように送られる（メールの送り先は、ステージングの設定に従う）。
- 自動公開だけが、ステージングで余分に送るということはない。

---

## 8. テストと受け入れ条件

### 8.1 自動テスト

サーバー（vitest-pool-workers）：

- 予約の設定と取り消し：`publishAt` が保存・NULL 化され、`findById` に出る。
- 過去の時刻 → 400 `publish_at_past`。`status: "published"` と一緒に送る → 400。
- `publishDueEvents`：
  - 時刻前の予約は変えない。
  - 過ぎたものだけ `published` にし、`publish_at` を NULL にし、`access_revision` を1増やす。
  - 同時に2回呼んでも、id を返すのは1回だけ。
  - 1分以内の2回目は D1 を読まない。
- 自動公開のあと、
  - 公開範囲が public のイベントでは、フォロワーへの通知が1件だけ。
  - たまごの賛同者への通知も1件だけ。
  - 未ログインの `GET /api/events/:id` が 200 になる（公開前は 404）。
- 手動で公開すると `publish_at` が NULL になり、そのあと `publishDueEvents` は何もしない。
- 古いフォーム：自動公開のあとに `status: "draft"` を revision なしで PATCH すると 409 `publish_state_changed` になり、状態は `published` のまま。

web（vitest）：

- 編集画面で「予約公開」を選ぶと日時の入力が出て、`publishAt` を送る。過去の日時では保存できない。
- 運営ページの予約中の表示と、2つのボタンが送るもの。
- `noPolling.test.ts` が通る（`setInterval` を足さない）。

### 8.2 受け入れ条件

- 予約した時刻を過ぎてからサイトにアクセスがあれば、1分程度で公開になる。一覧・検索・OGP・フィードにも出る。
- フォロワーやたまごの賛同者への通知は、手動で公開したときと同じ内容で、1回だけ届く。
- 取り消した予約は公開されない。予約中の手動公開で、通知が2回届くことはない。
- 古い編集フォームから保存しても、公開済みのイベントが黙って下書きに戻ることはない。
- ブラウザからの問い合わせは増えない。D1 で目立って増える読み取りもない。

---

## 9. 未決事項（オーナーに確かめること）

- **Q1 公開の遅れ**：予約時刻を過ぎて、サイトに誰かがアクセスした時点（通常は1分以内）で公開する方式でよいか。
  - アクセスが無い時間帯は、フォロワーへの通知もその分遅れる。
  - 必ず時刻どおりに動かすには、アカウントの Workers の cron 枠（5個とも使用中）を1つ空けて、5分おきの cron にする必要がある。
  - **推奨**：アクセスをきっかけにする方式。
- **Q2 予約を入れる場所**：予約公開を入れるのを編集画面だけにしてよいか（作成画面は今まで通り、下書きで作るだけ）。
  - **推奨**：編集画面だけ。作成後にすぐ編集画面で予約を入れられる。
