# イベントの予約公開（D-EVENT-SCHEDULED-PUBLISH）

オーナー依頼：「イベントの予約公開機能が欲しいです」

下書きのイベントに「公開する日時」を入れておくと、その時刻になったら自動で公開されるようにする。
この文書は設計の正本。基準にしたのは main `292bfae`。

**オーナー決定（2026-10）**

- Q1：時刻ちょうどに動かすため、Cloudflare の cron 枠を1つ空けて（noscha-io-staging の cron を外した）、**共用の定期実行 Worker `cron-hub`** を置く。
  - cron-hub が30分ごと（毎時0分・30分）に eventer を呼ぶ。
  - 予約できる時刻も毎時0分・30分だけにする（オーナー決定、2026-10-14）。毎分の確認は無駄が多いため。
  - 今後ほかの定期処理が要っても、同じ枠を使い回す。
- Q2：予約は編集画面だけで入れる。作成は今まで通り下書き。
- 自動で公開されたときも、公開のメールは手動で公開したときと同じ条件で、1回だけ送る。

---

## 1. 要件

### 1.1 やること

- 下書きのイベントに、公開予定の日時を設定・変更・取り消しできるようにする。
- その時刻を過ぎたら、イベントを自動で「公開」にする。手動の「公開する」と同じ通知を、**ちょうど1回だけ**送る。
- 予約中は、運営の画面に「○月○日 HH:mm に公開予定」と出す。
- 予約中でも「今すぐ公開」はでき、押すと予約は消える。

### 1.2 やらないこと

- **作成画面で予約を入れること**：作成は今まで通り必ず下書きで始まり、予約は編集画面で入れる（オーナー決定 Q2）。
- **予約の非公開化**（公開中のイベントを、決めた時刻に下書きに戻すこと）。
- **複数の予約や履歴**：予約は1件で、上書きするだけ。
- **分単位の予約**：予約できるのは毎時0分・30分だけ。cron-hub もその時刻にだけ動く（§3.3）。
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
- オーナーの承認を受けて、noscha-io-staging の cron を外し（kojira/noscha-io#2。Cloudflare 上の schedule も空にした）、枠を1つ空けた。この枠は共用の cron-hub が使う（§3.5）。

### 2.5 D-POLL-MIN の制約

- ブラウザから定期的に問い合わせない（`setInterval` は使わない。`noPolling.test.ts` で確かめている）。
- 新しい定期読み取りで D1 の読み取り行数を増やさない。

---

## 3. 方式

### 3.1 案の比較

| 案 | 中身 | 判断 |
|---|---|---|
| (a) 読み取り時に判定 | `status='published' OR (status='draft' AND publish_at<=now)` を、2.3 の全部の読み取りに入れる。通知は別に起こす必要がある | **採らない**。約60か所の SQL と `eventViewSql` を書き換えることになり、漏れたところで「見えるのに一覧に出ない」「通知が来ない」が起きる。それに、通知を起こすきっかけは結局どこかに要る |
| (b) **定期実行で状態を切り替える（採用）** | 共用の cron-hub が30分ごと（毎時0分・30分）に eventer 本番の `publishDueEvents()` を呼び、`draft` を `published` に変えて通知を送る | **採用**。状態は今の `status` のままなので、2.3 の読み取りは1行も変えなくてよい。通知も、既存の1回だけにする仕組みで済む。アクセスが無い時間帯でも遅れない |
| (c) リクエストをきっかけに切り替える | Worker が受けたリクエストの最初に確かめる | **採らない**。アクセスが無い時間帯は最大30分ほど遅れる（本番の実測）。オーナーが (b) を選んだ |

- Durable Object の alarm や Queues の遅延配信は、「KV / DO を入れない」方針と仕組みの最小化に反するので採らない。

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

### 3.3 切り替えの処理（eventer）

`apps/server/src/lib/scheduledPublish.ts` を新しく作る。

```ts
export async function publishDueEvents(now = Date.now()): Promise<{ published: string[] }> {
  const rows = await many<{ id: string }>(
    `UPDATE event SET status='published', publish_at=NULL, access_revision=access_revision+1
      WHERE publish_at IS NOT NULL AND publish_at<=? AND status='draft'
      RETURNING id`, now);
  for (const { id } of rows) await runPublishSideEffects(id);
  return { published: rows.map(r => r.id) };
}
```

- **`runPublishSideEffects(id)`**：`findById` で読み直して `notifyOnPublish({ ...event, status: "draft" }, event)` を呼ぶ。そのうえで `eventSignal.publishRefetch([["live", id]])` を出す（PATCH で公開したときと同じシグナル）。
  - `notifyOnPublish` は eventCrud.ts から `lib/publishNotify.ts` に移し、手動・自動の両方が同じ関数を使う。中身は変えない。
  - 1件の通知が失敗しても、ほかのイベントの通知は続ける（try/catch でログを残す）。公開そのものは UPDATE で終わっているので、通知の失敗で状態は戻さない（今の手動公開と同じ扱い）。
- **呼ばれ方は2つだけ**：
  1. **cron-hub からの RPC**（本番）。eventer の `CronEntrypoint`（`WorkerEntrypoint` を継ぐ名前付きエントリポイント）の `publishDueEvents()`。Service Binding でしか呼べず、公開の HTTP には出さない。
  2. **手動の実行用 API** `POST /api/admin/run-scheduled-publish`（app admin だけ）。`/api/admin/run-reminders` と同じ形で、staging の確かめ用。
- **staging**：cron-hub は本番と staging の両方の eventer を呼ぶ（オーナー決定、2026-10-14）。待たずに確かめたいときは手動の実行用 API を使う。
- **遅れ**：予約は毎時0分・30分だけで、cron-hub も同じ時刻に動くので、遅れは cron の起動のずれ（数秒〜数十秒）だけ。
- **D1 のコスト**：部分索引 `idx_event_publish_at` を引くだけ（条件は `+status = 'draft'` と書き、`idx_event_status` で下書きを全部読まないようにする。本番の実測で rows_read 4 → 1。EXPLAIN QUERY PLAN をテストで固定）。予約が0件なら、読み取りはほぼ0行。30分に1回で、1日48回の小さな書き込みクエリが増える。D-POLL-MIN で減らした量（数百行/時）に対して、誤差の範囲。ブラウザからの問い合わせは増えない。

### 3.4 1回だけを守る仕組み

- `UPDATE … WHERE status='draft' AND publish_at<=? RETURNING id` は1つの文で原子的に動く。cron の実行が重なっても、手動の実行と重なっても、行を変えた側だけが id を受け取る。だから同じイベントの通知が2回走ることはない。
- 手動の公開（PATCH・POST /publish）は、同じ UPDATE の中で `publish_at = NULL` に戻す。手動で公開した後は、自動の切り替えの条件（`status='draft'`）に当たらない。
- フォロワーへの通知は、これまで通り `claimFollowersNotify` で1回だけになる。公開 → 下書き → 再び予約 → 自動公開、と進んでも、2回目は送らない（今の手動公開と同じ）。

### 3.5 共用の定期実行 Worker（cron-hub）

- **置き場所**：新しい private リポジトリ `kojira/cron-hub`。
  - 1つのアカウントの複数のプロジェクトが使い回すものなので、eventer の中に置くと、ほかのプロジェクトを足すたびに eventer の変更になってしまう。
  - ワークスペースに、こうした共用 Worker の置き場所の決まりは無い。
- **中身**：
  - `wrangler.toml`：`crons = ["0,30 * * * *"]`（毎時0分・30分）。行き先ごとに `[[services]]` を書く（最初は `binding = "EVENTER", service = "eventer", entrypoint = "CronEntrypoint"` の1つだけ）。
  - `scheduled()` は、行き先の一覧（コードの配列。今は1件）を `Promise.allSettled` で呼ぶ。
    - 1つの行き先の失敗が、ほかを止めない。
    - 失敗は `console.error` で、行き先名とエラーを残す。Workers Logs で見る。
  - `fetch()` は 404 だけ返す（HTTP では何もしない）。
- **安全性**：Service Binding は同じアカウントの Worker からしか呼べない。eventer は RPC のメソッドだけを出し、`x-cron-key` の秘密は使わない。
- **配備の順番**：
  1. eventer に `CronEntrypoint` が入った版を本番に出す。
  2. そのあとで cron-hub を配備する。
  - cron-hub の配備は、eventer の本番リリースの承認と一緒に行う。

---

## 4. 画面

予約公開を入れるのは編集画面だけ。運営ページと詳細ページには表示を足す。

### 4.1 編集画面（`EditEventPage.tsx`）

「公開状態」のトグルを3択にする。

```
公開状態
[ 非公開（下書き） ][ 予約公開 ][ 公開 ]
 公開する日時                         ← 「予約公開」を選んだときだけ出す
 [ 公開する日 2026-10-20 ][ 公開する時刻 12:00 ▾ ]
 この日時になると自動で公開され、フォロワーに通知されます。30分単位（毎時0分・30分）で選べます。
```

- 日付は `type="date"`、時刻は 00:00〜23:30 の30分刻みの select で入れる。`datetime-local` の `step` はスマホのブラウザで効かないため、分けて選ばせる。値は締切日時と同じ変換（`toLocalInput` / `fromDateTimeLocal`）を使う。
  - 初めて「予約公開」を選んだときは、次の0分か30分を入れておく。
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
- 30分区切りでない時刻（`publishAt % 1800000 !== 0`）も 400 `publish_at_unaligned`。JST は UTC+9 なので、epoch ms の30分区切りが JST の毎時0分・30分になる。読み込んだときから変えていない予約は弾かない。
- `archived` のイベントや、`status: "published"` と一緒に `publishAt` を送った場合も 400 `publish_at_invalid`。

### 5.5 編集フォームが古いまま保存された場合（重要）

今の編集フォームは、保存のたびに `status` を送っている。何もしないと、次のように取り消しが起きてしまう。

1. 下書きのときにフォームを開く。
2. その間に、自動で公開される。
3. 古いフォームのまま保存すると、`status: "draft"` が送られる。
4. **公開したばかりのイベントが、黙って下書きに戻ってしまう。**

これを防ぐため、サーバーで次のように確かめる。

- 次のどちらかの保存では、`expectedAccessRevision === 今の accessRevision` を必須にする。合わなければ 409 `publish_state_changed` を返す。
  - 公開中（または公開済み）のイベントを `status: "draft"` にする。
  - `publishAt` を今の値から変える。
  - 下書きを公開する（`status: "published"`）だけの保存には revision を求めない。今の `POST /publish` と同じ扱いで、古いフォームから送られても「公開を取り消す」事故にはならないため。
  - 実装中に、ここを狭めた。「`status` の変更はすべて revision 必須」にすると、今の `PATCH { status: "published" }` の使い方（テストで約50か所）が壊れる。そのうえ、防げる事故は増えない。
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
| サーバー | `lib/publishNotify.ts`（新規） | eventCrud.ts から `notifyOnPublish` を移す |
| サーバー | `worker.ts` | `export class CronEntrypoint extends WorkerEntrypoint`（`publishDueEvents()`） |
| サーバー | `routes/adminReminders.ts` | `POST /api/admin/run-scheduled-publish`（app admin だけ） |
| cron-hub | `kojira/cron-hub`（新規） | `wrangler.toml`（cron・service binding）と `src/index.ts` |
| web | `pages/EditEventPage.tsx` | 3択のトグル、日時の入力、`expectedAccessRevision` の付け方 |
| web | `pages/EventManagePage.tsx` | 予約中の警告と、2つのボタン |
| web | `pages/EventDetailPage.tsx` | 「公開予定」のチップ |

テストで列名を並べている箇所（`PRAGMA table_info(event)` を使うもの）は、実装時に必要なら直す。

---

## 7. ステージングでの確かめ方

- ステージングにも同じ migration 0111 を当てる（本番の前に、手で）。
- ステージングでは cron-hub は動かないので、時刻を過ぎたら app admin が `POST /api/admin/run-scheduled-publish` を呼ぶ。

確かめる手順：

1. テスト用の下書きイベントで、**今から2〜3分後**に予約公開を入れて保存する。運営ページに「HH:mm に自動で公開されます」と出ることを確かめる。
2. 時刻前に実行用 API を呼んでも、`published: []` で何も変わらないことを確かめる。
3. 時刻を過ぎてから実行用 API を呼ぶ。`published` にそのイベントが入り、再読み込みすると状態が「公開」になり、一覧にも出ることを確かめる。もう1回呼ぶと `published: []` になる。
4. テスト用のアカウントで作成者をフォローしておき、「イベントを公開しました」の通知が**1件だけ**届くことを確かめる。
5. もう1件予約を入れて取り消し、時刻を過ぎて実行しても公開されないことを確かめる。
6. もう1件予約を入れて「今すぐ公開」を押し、すぐ公開されることを確かめる。時刻を過ぎて実行しても、通知が増えないことも確かめる。

本番で確かめること（cron-hub の配備後）：

- Cloudflare の cron-hub の実行記録が毎時0分・30分に成功している。
- 予約を入れたテスト用の下書きが、予約した0分・30分の実行で公開になる。

---

## 8. テストと受け入れ条件

### 8.1 自動テスト

サーバー（vitest-pool-workers）：

- 予約の設定と取り消し：`publishAt` が保存・NULL 化され、`findById` に出る。
- 過去の時刻 → 400 `publish_at_past`。30分区切りでない時刻 → 400 `publish_at_unaligned`。`status: "published"` と一緒に送る → 400。
- `publishDueEvents`：
  - 時刻前の予約は変えない。
  - 過ぎたものだけ `published` にし、`publish_at` を NULL にし、`access_revision` を1増やす。
  - 同時に2回呼んでも、id を返すのは1回だけ。
- `POST /api/admin/run-scheduled-publish` は app admin 以外には 403 を返す。
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

- 本番では、予約した時刻（毎時0分・30分）の cron 実行で公開になる（アクセスの有無に関係なく）。一覧・検索・OGP・フィードにも出る。
- フォロワーやたまごの賛同者への通知は、手動で公開したときと同じ内容で、1回だけ届く。
- 取り消した予約は公開されない。予約中の手動公開で、通知が2回届くことはない。
- 古い編集フォームから保存しても、公開済みのイベントが黙って下書きに戻ることはない。
- ブラウザからの問い合わせは増えない。D1 で目立って増える読み取りもない。

---

## 9. 決まったこと

- **Q1**：(b) 共用の cron-hub で動かす（§3.5）。最初は1分ごとだったが、2026-10-14 のオーナー決定で30分ごと（毎時0分・30分）にし、予約できる時刻も同じにした。noscha-io-staging の cron 枠を譲った。
- **Q2**：予約は編集画面だけ。
- 公開のメールは、自動で公開されたときにも、手動のときと同じ条件で1回だけ送る。
