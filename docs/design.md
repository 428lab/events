# Eventer（events lab）設計ドキュメント

イベント運営支援ツール（当初はアイディアソン・ハッカソン向けとして設計）

- 初版: 2026-05-30 ／ 差分追記: 2026-07-13 ／ 差分の更新: 2026-09-02（#456）
- ステータス: **初期設計の記録**。データモデル（Entry 抽象・ロール・モード設計）は現行実装と一致するが、インフラ・認証・リアルタイムは下記のとおり実装が置き換わっている。

---

## 0. 現在の実装との差分（2026-07-13 時点）

初版設計から実装が変わった点。以降の章は歴史的記録として残す（★印の章は置き換え済み）。

| 項目 | 初版設計（本書） | 現在の実装 |
|------|----------------|-----------|
| 実行環境（★2,3章） | Node.js + Hono ＋ Cloudflare Tunnel 公開 | **Cloudflare Workers**（単一 Worker が SPA 配信・OG 注入・API を担当。`apps/server/src/worker.ts`） |
| DB（★2,3章） | SQLite（better-sqlite3・同期） | **Cloudflare D1**（SQLite 互換・非同期）。リポジトリ層方針は維持（`db/client.ts` の `one/many/run/batch`） |
| 画像 | — | **R2**（イベント画像・コミュニティ画像・スライド画像。D1 にはメタのみ） |
| マイグレーション（★2章） | 自前ランナー + `schema_migrations` | **`wrangler d1 migrations`**（`apps/server/migrations/*.sql`） |
| 認証（★5章） | Discord OAuth のみ | **Discord / Google / GitHub / X OAuth + Nostr NIP-07 + Bluesky（AT Protocol OAuth。`docs/bluesky-login.md`）**。`identity` テーブルで複数連携・引き取り対応 |
| リアルタイム（★8章） | SSE | **2秒ポーリング**（Workers はアイソレートを跨げず in-memory SSE ハブが機能しないため。無料枠維持のため Durable Objects 不使用） |
| 環境変数（★5章） | `.env` | `wrangler.toml [vars]` + `wrangler secret` + ローカルは `.dev.vars` |
| ルーティング（★9章） | `/admin/events/...` 系 | 管理画面はイベント配下（`/events/:id/edit`・`/scoring`・`/present`・`/awards`・`/control`）。他に `/e/:slug`（短縮）・`/c/:slug`（コミュニティ）・`/d/:slug`（スライド）・`/users/:id` など |
| デプロイ | 手動 build + Tunnel | GitHub Actions（`staging`/`production` ブランチ → wrangler deploy）＋ staging はログイン必須ゲート |

初版設計後に追加された主な機能（本書には未記載）:
日程調整（候補日投票・確定通知・祝日表示）、参加枠（先着／抽選・手動当落・キャンセル待ち繰り上げ）、コミュニティ、スライド（デッキ）、アプリ内通知、問い合わせ、公開ユーザープロフィール、短縮シェア URL、イベント検索・ページング、セキュリティ強化一式、イベントチャット、タイムテーブル（トラック・裏方 `docs/staff-timeline.md`）、スタッフ運用（招待・持ち場 `docs/staff-roles.md`・準備 TODO `docs/staff-todo.md`・スタッフチャット `docs/staff-chat.md`）、写真・動画、出会い（QR 名刺交換）、ビンゴ、アンケート、メール通知ほか。機能の現状一覧は `README.md` を、個別機能の設計は `docs/` の各ドキュメントを参照。

---

## 1. 概要・目的

アイディアソン／ハッカソンの運営を支援する Web アプリケーション。

- **オフライン／オンライン両対応**。オンライン時の通話は Discord を利用する前提。
- ログイン（Discord OAuth）、イベント管理、参加者マイページを最初に実装し、「参加できる状態」を作る。
- **チーム参加は将来実装**だが、それを見据えた柔軟なデータモデルを初期から採用する。
- 採点・集計・表彰までを一気通貫で扱い、当日のイベント進行（プレゼン→集計→表彰）をモード切替で制御する。

### 設計の中心となる考え方: 「エントリー（参加単位）」抽象

採点・成果物・表彰を `User` や `Team` に直接紐づけると、チーム機能追加時に大規模な作り直しが発生する。
そこで **`Entry`（参加単位）** という抽象を導入する。

- `Entry` はイベントへの「参加の単位」を表す。
- 個人参加モードでは `Entry` = 1人のユーザー。
- チーム参加モード（将来）では `Entry` = 1チーム。
- **採点・成果物・表彰・プレゼン対象はすべて `Entry` を参照する。**

これにより、個人参加→チーム参加への移行が「`Entry` の構成方法が変わるだけ」で済み、採点・集計・表彰ロジックには一切手を入れずに拡張できる。

---

## 2. 技術スタック

| 領域 | 採用技術 | 理由 |
|------|----------|------|
| フロントエンド | React + Vite + TypeScript + MUI | 指定。SPA で軽量・高速。Next.js は不使用。 |
| 状態管理 / データ取得 | TanStack Query + Zustand | サーバー状態は Query、UI 状態（モードなど）は Zustand。 |
| ルーティング | React Router | SPA ルーティング。 |
| バックエンド | Node.js + Hono + TypeScript | 軽量・高速・TS ネイティブ。フロントと言語統一。Cloudflare とも相性良。 |
| DB | SQLite（better-sqlite3）+ 自前の簡易リポジトリ層 | 単一ファイルで運用容易。**SQLite 専用で固定**（PostgreSQL 等への移行は考慮しない）。重い ORM は入れず、薄いデータアクセス層を自前実装する。 |
| 認証 | Discord OAuth2 + セッション Cookie | 指定。 |
| リアルタイム | SSE (Server-Sent Events) | モード切替・採点状況のサーバー→クライアント通知に最適。実装が軽い。 |
| パッケージ管理 | pnpm（workspace モノレポ） | 指定。フロント／バックを単一リポジトリで管理。 |
| 公開 | Cloudflare Tunnel | 指定。ローカル/オンプレを安全に公開。 |

### データアクセス方針（重要）

- **DB は SQLite で永続的に固定。** 他 DB への移行は考慮しない。
- 重い ORM は導入せず、`better-sqlite3` の上に **薄い「簡易 ORM ＝ リポジトリ層」を自前実装**する。
- **生 SQL を書いてよいのはリポジトリ層（`apps/server/src/db/repositories/*`）だけ。** ルートハンドラやサービスから直接 SQL を書かない。
- 各テーブルに対応するリポジトリがテーブルごとの型付きメソッド（`findById` / `list` / `insert` / `update` / `delete` / 集計用クエリ等）を提供する。SQL の重複・散在を防ぐ。
- **原則はテーブル単位だが、それだけで切ると「同じ定義が2か所に書かれる」ほうが起きる (#466, #335)。**
  次の2つは、テーブルではなく**定義の置き場所**としてリポジトリ層に別ファイルを立てる。
  - **複数のリポジトリが共有する定義**（`kpiMetrics.ts` = 指標の SQL 断片、`userTables.ts` = ユーザーを参照する表の対応）。
    ここに置いたものは**1か所にしか書かない**。全体KPIとコミュニティKPIのように同じ指標を2つのリポジトリが数えるとき、
    片方だけ直せば数字は黙ってズレる。ユーザー参照表も同じで、表が増えたとき統合だけ直して退会が漏れる。
  - **1つのテーブルに収まらない大きな手続き**（`accountMerge.ts` = アカウント統合、`accountDeletion.ts` = 退会と完全削除）。
    どちらも数十の表をまたぎ、**文の実行順序そのものが仕様**（FK RESTRICT を先に解消する、ログイン手段を最後に移す）。
    プロフィールの読み書きと同居させると、順序の理由が読み手に見えなくなる。
  - 共有する定義を置くファイルは SQL の断片（`HELD` / `JOINED` のようなテンプレート文字列）までに留め、クエリビルダーは作らない。
    呼び出し側で **D1 に何が飛ぶかが読めること**を、行数より優先する。
- 行↔オブジェクトの相互変換（snake_case カラム ↔ camelCase プロパティ、bool↔integer、日時変換）はリポジトリ層内のマッパで吸収する。
- マイグレーションは `apps/server/src/db/migrations/*.sql` を順番に適用する自前のシンプルなマイグレーションランナーで管理（バージョン番号を `schema_migrations` テーブルで記録）。

### バックグラウンド処理の実行文脈 (#317)

レスポンスを待たせたくない処理（メール送信、アイコンの取り込み、最終アクセス時刻の記録、
OG メタの取り直し）は `runtime.ts` の `deferBackground()` に渡す。渡した処理は
Cloudflare Workers の `ExecutionContext.waitUntil` に載り、レスポンス送出後も走り続ける。

- **実行文脈はリクエストごとに持つ。モジュール変数に置かない。**
  Workers は1つのアイソレートで複数のリクエストを同時に捌く。バインディング（D1・R2・ASSETS）は
  アイソレート内で同一ハンドルなのでモジュール変数（`bindEnv`）で共有してよいが、
  `ExecutionContext` は**そのリクエスト1回**に属する。モジュール変数に置くと、
  リクエストAがネットワーク待ちをしている間にBが上書きし、Aの背景処理がBの `waitUntil` に付く。
  Bのレスポンスが先に終われば、**Aの背景処理は走り切る前に打ち切られる**（送ったつもりのメールが出ない、
  取り込んだつもりのアイコンが保存されない）。
- 文脈の受け渡しは `AsyncLocalStorage`（`nodejs_compat` が要る）で行う。
  `deferBackground` の呼び出し元はリポジトリ層まで深く、Hono の `Context` を引き回すと
  db 層が HTTP フレームワークに依存する。呼び出し側の書き方を変えずに文脈だけを
  リクエストに閉じ込められるのが決め手。
- **文脈を張るのは Worker のエントリ（`worker.ts`）だけ。** `fetch` と `scheduled`（cron）が
  それぞれ `runWithExecutionContext(ctx, ...)` で1回ずつ張る。到達経路を1本に保つため、
  モジュール変数の控えは置かない。文脈の外（テストからの直接呼び出しなど）では
  `deferBackground` はその場で `await` する。
- メール送信・OG取得の**予算**（`takeEmailSlot` / `takeOgFetchSlot`）は今も
  アイソレート共有のモジュール変数のまま。こちらは暴走防止の安全弁で、
  多めに数えて送信を控える側に倒れるだけなので、取りこぼしにはならない。

### リアルタイム方針の補足

- **SSE** はサーバー→クライアントの一方向通知に使う：モード切替、プレゼン対象の変更、採点提出状況の更新、表彰の段階発表。
- クライアント→サーバー（採点の送信など）は通常の REST(POST) で行う。送信後、サーバーが SSE で全クライアントへ状態をブロードキャストする。
- 双方向の細かい同期（将来のスライド連動など）が必要になった段階で WebSocket への置き換えを検討する。SSE/REST の組み合わせは MVP には十分。

---

## 3. 全体アーキテクチャ

```
┌──────────────────────────────────────────────┐
│                Cloudflare Tunnel               │
└───────────────────────┬──────────────────────┘
                        │ HTTPS
            ┌───────────▼───────────┐
            │   Hono (Node.js)       │
            │  ┌──────────────────┐  │
            │  │ REST API         │  │
            │  │ /api/*           │  │
            │  ├──────────────────┤  │
            │  │ SSE              │  │
            │  │ /api/events/:id/ │  │
            │  │   stream         │  │
            │  ├──────────────────┤  │
            │  │ 静的配信         │  │  ← ビルド済み SPA を配信
            │  │ (Vite build)     │  │
            │  └──────────────────┘  │
            └───────────┬───────────┘
                        │
                ┌───────▼───────┐
                │   SQLite       │
                │ (better-sqlite3)│
                └───────────────┘
```

- 本番では Vite でビルドした SPA を Hono が静的配信し、同一オリジンで API/SSE を提供（Cookie 認証が単純になる）。
- 開発時は Vite dev server（フロント）と Hono（API）を別ポートで起動し、Vite の proxy で `/api` を Hono へ転送。

### モノレポ構成（pnpm workspace）

```
eventer/
├─ pnpm-workspace.yaml
├─ package.json
├─ docs/
│  └─ design.md
├─ packages/
│  └─ shared/            # フロント・バック共有の型 / Zod スキーマ / 定数
│     ├─ src/
│     │  ├─ schema/      # API 入出力の Zod スキーマ（型を両者で共有）
│     │  └─ constants/   # ロール、モード等の enum
│     └─ package.json
├─ apps/
│  ├─ web/               # React + Vite + MUI
│  │  ├─ src/
│  │  │  ├─ pages/
│  │  │  ├─ components/
│  │  │  ├─ features/    # 機能単位（event, scoring, awards, presentation ...）
│  │  │  ├─ hooks/
│  │  │  ├─ api/         # API クライアント
│  │  │  └─ store/       # Zustand
│  │  └─ package.json
│  └─ server/            # Hono + better-sqlite3
│     ├─ src/
│     │  ├─ routes/      # ルートハンドラ（SQL は書かない。リポジトリを呼ぶ）
│     │  ├─ db/
│     │  │  ├─ client.ts       # better-sqlite3 接続
│     │  │  ├─ repositories/   # ★生 SQL はここだけ。テーブルごとの型付きメソッド
│     │  │  ├─ migrations/     # 連番 .sql
│     │  │  └─ migrate.ts      # 自前マイグレーションランナー
│     │  ├─ services/    # ビジネスロジック（採点集計など。リポジトリ経由でアクセス）
│     │  ├─ auth/        # Discord OAuth, セッション
│     │  ├─ sse/         # SSE ハブ（イベントごとのチャンネル管理）
│     │  └─ middleware/
│     └─ package.json
└─ data/
   └─ eventer.db         # SQLite（gitignore）
```

`packages/shared` に Zod スキーマを置き、フロント・バックで同じ型・バリデーションを共有する（型の二重管理を防ぐ）。

### 文言（i18n）の置き場

画面・サーバー・メールが同じ文言を見るので、辞書は `packages/shared/src/i18n/messages/`
に置く。**1ファイル＝1領域＝1名前空間**で、`t("領域.キー")` の領域はファイル名と一致する。

**ja と en は同じファイルの中で隣り合わせにする。** 型（`en: Record<keyof typeof ja, string>`）
が守れるのは「両方の言語に同じキーがあること」までで、**どちらがどちらの訳かは守れない**。
離れていると、片方だけ直したり別の節に足したりしても何も落ちない。隣にあれば目で気づく。

領域が育って複数の画面を抱えたら、**画面ごとのファイルに割ってディレクトリにする**
（`messages/staffOps/` がその形。運営専用画面が15画面ぶん1ファイルに溜まり、
1つのキーの ja と en が430行離れていた）。割っても**名前空間は1つのまま**にして、
呼び出し側の `t("staffOps.xxx")` は変えない。**辞書の分割は書く側の都合で、
呼ぶ側に持ち込まない。**

割った各部を1つの辞書に束ねるときは、キーの衝突が静かに握り潰される。
型では拾えないので、結合後のキー数が各部の合計と一致することをテストで見張る。

### 3.1 `/api/events` の認証境界（登録順が契約）

イベント配下のルートはファイル数が多いので、**認証境界を1か所に固定**している。
`routes/events.ts` が `/events` の合成のルートで、そこに並んだ
`use("*", requireAuth)` **より前**に登録されたものだけが未ログインで通る。
Hono の `route()` は呼び出した時点で子のルートを親へ展開するため、
**ファイルの並び順がそのままルーターの登録順＝振る舞い**になる。

これは `worker.ts` の登録順ごと契約になっている。`api.route("/events", eventRoutes)`
より**前**に登録されたもの（公開画像・公開コメント一覧など）は認証なしで通り、
**後ろ**に登録されたもの（`scoring.ts` など20本以上）は必ずこの `requireAuth` を通る。

境界を1か所に保つ理由は、経路ごとに `requireAuth` を置くと
「1リクエストでセッション照会が何度も走る」「置き忘れた1本だけ素通しになる」の
両方が起きるため。認証なしで読ませたい GET を増やすときは `routes/eventsPublic.ts`
に足すこと（`canViewEvent` を通す前口上もそこに1本だけある。通し忘れると
**下書きイベントの中身が未ログインで読めてしまう**）。

**配下のサブアプリは自前の `use("*", requireAuth)` を持たない (#472)。** Hono の
ミドルウェアはパターン一致で積まれるので、`/events` に並べたサブアプリが各自
`use("*")` を持つと、**どのサブアプリのハンドラを叩いても、並べた全部の
requireAuth が順に走る**。#472 の時点で22本が自前で重ねており、最も後ろに並ぶ
`/api/events/:id/staff-invites` では requireAuth が23回、1回あたりセッションと
ユーザーで2クエリ＝**1リクエストで D1 を46回**引いていた。重ねても安全側に
倒れるだけで応答は変わらないため、消しても振る舞いは動かない（533本の登録
ルートを実際のルーターに引かせて、認証の有無が1本も変わらないことを確かめてある）。

置き忘れ・置きすぎのどちらも `apps/server/test/auth-boundary.test.ts` が見張る。
登録済みルートを1本ずつ歩いて、そのハンドラに届くまでに通る `requireAuth` が
**ちょうど1回**であること、未認証で通る経路は表に書いたものだけであることを
確かめる。**認証の要らない経路を足すときは、この表にも足す**（足さなければ落ちる）。
`worker.ts` の並びを崩して境界より前にサブアプリを置いた場合も落ちる。

**この表への追加は、認可の変更として読むこと。** 境界の外へ経路を1本出しても、
その鍵を表に足せば検査は通る（サブアプリ丸ごとは全パスぶん足すことになるので
通らないが、1本なら通る）。表がこの検査の唯一の抜け道なので、
「テストを通すために足した」差分をレビューが素通ししたら、そこで守りは終わる。
事故で足せないよう件数も突き合わせてあり、表を触ると必ず差分に現れる。

ワイルドカードを含むパス（`use("*")` など）は代表パスを作れないので歩けない。
ミドルウェアは終端ではないので歩けなくても穴にならないが、ワイルドカードに
**終端ハンドラ**を載せると検査を素通りしてしまう。`next` を受け取るかどうか
（引数の数）で見分けて、終端ハンドラは `worker.ts` 末尾の ASSETS フォールバック
1本だけであることを固定している。`api.all("/x", h)` のような ALL メソッドの
終端ハンドラは、ワイルドカードでない限り普通に歩く対象に入る。

`routes/events.ts` 配下は責務の軸で分けてある（`eventCrud` / `eventsPublic` /
`eventDateOptions` / `eventDuplicate` / `eventMembers` / `eventSlots` /
`eventCheckin` / `eventEntries`）。1ファイルに足し続けると権限の検査が経路ごとに
コピーされて必ずずれるため、軸で選んで置く。

**子リソースは親の所有を検証する。** `requireEventRole` が見ているのは `:id` の
イベントに対する権限だけなので、`:slotId` や `:entryId` がそのイベントのものかは
別に確かめる。省くと、自分が staff のイベントの ID に他人のイベントの子 ID を
付けるだけで他人の枠や成果物を操作できてしまう。

---

## 4. データモデル

### 4.1 ER 概観

```
User ──< EventMember >── Event
                          │
Event ──< Entry            │  （参加単位: 個人 or チーム）
   Entry ──< EntryMember >── User   （Entry に属するユーザー。個人参加なら1人）
   Entry ──1 Submission              （成果物）
   Entry ──< Score                   （この Entry に対する採点）
   Entry ──< AwardResult             （受賞結果）

Event ──< ScoringCriterion           （採点項目）
Event ──< AwardRank                  （ランキングの賞: 1位/2位…）
Event ──< SpecialAward               （ランキング外の特別枠）
Event ──1 EventState                 （現在のモード・プレゼン対象など）

Team（将来）──1 Entry                 （チーム参加時、Entry の実体）
```

### 4.2 テーブル定義

> 型は SQLite ベース。日時は UNIX epoch(integer) で保持。スキーマは `db/migrations/*.sql` で定義し、アクセスはリポジトリ層経由。

#### user
| カラム | 型 | 説明 |
|--------|----|------|
| id | text (uuid) PK | |
| discord_id | text unique | Discord ユーザー ID |
| username | text | 表示名 |
| global_name | text null | Discord グローバル名 |
| avatar_url | text null | 表示に使うアイコンURL。自前保管できていれば `/api/users/{id}/avatar?v={更新時刻}` (#312) |
| created_at | integer | |
| last_seen_at | integer null | 最終アクセス時刻。null = 計測開始 (#257) より前からのユーザー |
| avatar_image_updated_at | integer null | 自前保管したアイコンの更新時刻。null = 保管なし (#312) |
| avatar_image_mime | text null | 保管したアイコンの MIME（配信時の Content-Type） |
| avatar_image_hash | text null | 保管したアイコンの SHA-256。中身が変わったときだけ書き直すための比較用 |
| avatar_source_url | text null | 取り込み元（連携先）のアイコンURL。`avatar_url` を上書きするため、切り戻し用に元のURLを残す |
| avatar_sync_attempted_at | integer null | 最後に取り込みを**試みた**時刻。成否・変更の有無に関わらず進む。スロットルの判定に使う |

- アイコンは**ログインのたびに**、そのとき使った連携先（Discord / Google / GitHub / X / Nostr）から取り直して R2 `avatars/{user_id}` に保管し、`avatar_url` を自分のドメインのURLへ差し替える (#312)。連携先のURLをそのまま持つと、向こうでアイコンを変えられた時点で 404 になるため。
- 取得はレスポンスを待たせない（`deferBackground` = そのリクエストの `ctx.waitUntil`。2章「バックグラウンド処理の実行文脈」）。連携先CDNが遅いときにログインが取得タイムアウトぶん待たされるのを避けるため。
- 取得先は https 限定で、リダイレクトは手動追跡してホップごとにスキーム・プライベートホストを再検証する（SSRF ガード。判定は `lib/urlGuard.ts` に集約し OG サムネイル取得 #149 と共有）。Content-Type の許可リストに加え、実バイト列の先頭シグネチャも突き合わせる。
- 取得に失敗（連携先が落ちている・既に 404・大きすぎる・画像でない）してもログインは成功させ、既存の `avatar_url` を残す。見送った理由は1行ログに残す。
- 中身（ハッシュ）が前回と同じなら R2 も `avatar_image_updated_at` も書き換えない。毎ログインで `?v=` が変わると同じ画像を再ダウンロードさせてしまうため。ただし取得元URLだけが変わっていた場合（連携先CDNのURLローテーション）は `avatar_source_url` だけ追随させる。切り戻し用に控えているURLが既に 404 のものになるのを避けるため。
- 取得元URLを本人が自由に書ける経路（Nostr の kind:0）は、直近10分以内に**試みて**いればスキップする。判定に `avatar_image_updated_at` を使わないのは、あれが中身の変化でしか進まず、同じ画像を返し続けるURLでは一度も発火しないため（外向きの取得そのものを抑止したい）。
- 配信 `GET /api/users/{id}/avatar?v=` は `?v=` を ETag として使い、条件付きGETを D1 の前で捌く。`Cache-Control: public, max-age=31536000, immutable, s-maxage=300` ＋ `caches.default` でエッジにも載せる。`s-maxage` を短く分けているのは、エッジに載った分をパージできず、退会したユーザーのアイコンが D1 の行と R2 の実体を消したあとまで配信され続けるのを避けるため。キャッシュキーは `?v=` だけに正規化する。
- 古い `?v=` のURLは、その時点の画像を返す（エッジキャッシュに載っている場合）。中身が変わると `?v=` ごと変わる設計なので、これは同じ内容の別バージョンではなく「その版の画像」が返っているだけ。`avatar_url` は毎回 D1 から読まれるため、画面を開き直せば新しい `?v=` に切り替わり、古いURLが表示に使われ続けることはない。

#### user_active_day（日次の活動記録 #257）
| カラム | 型 | 説明 |
|--------|----|------|
| day | text | JST の `YYYY-MM-DD` |
| user_id | text | ユーザー（FK は張らない） |

- primary key(day, user_id)。1ユーザー1日ちょうど1行。
- 認証を通ったリクエストで、**JST の日付が変わった最初の1回だけ** `user.last_seen_at` と同じ batch で記録する（書き込みは 1ユーザー 1日 1回）。
- `last_seen_at` は「**最終**アクセス日」しか持たないため、日別に集計しても出るのは休眠分布であって DAU の推移にはならない。日別 DAU / WAU / MAU / コホート残存 / 休眠復帰はこの表から算出する。
- user への FK を張らないのは、退会・完全削除でユーザー行が消えても過去の集計値を動かさないため（監査ログと同方針）。
- 保存期間は当面無制限（サイズ試算と見直しの条件は `migrations/0056_user_last_seen_at.sql` のコメント）。

#### event
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| title | text | タイトル |
| description | text | 内容（Markdown 可） |
| starts_at | integer | 開始日時 |
| ends_at | integer | 終了日時 |
| venue_type | text | `offline` / `online` / `hybrid` |
| venue_offline | text null | オフライン会場の場所 |
| venue_online | text null | オンライン会場（Discord 招待 URL 等） |
| participation_type | text | `individual` / `team`（初期は individual 固定） |
| aggregate_self_entry | integer(bool) | 自分の所属 Entry への採点を集計に含めるか |
| status | text | `draft` / `published` / `archived` |
| created_by | text FK→user | |
| created_at | integer | |

- **「オンラインの場合はすべての成果物を集約」**: オンライン/ハイブリッドイベントでは、各 Entry の `Submission`（プレゼン資料 URL・ソースコード URL）を 1 ページに集約表示する「成果物一覧ページ」を提供する。

#### event_member（ユーザーのイベント参加とロール）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| user_id | text FK→user | |
| role | text | `participant` / `staff` / `judge` / `observer` |
| created_at | integer | |

- unique(event_id, user_id)
- **ロールはイベントごとに異なる**ため、ユーザー単位ではなくこの中間テーブルで持つ。
- 1ユーザーが同一イベントで複数ロールを持つ要件が出た場合は role を別テーブル化（多対多）に拡張可能。初期は単一ロール。

#### entry（参加単位）★中心テーブル
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| kind | text | `individual` / `team` |
| name | text | 表示名（個人なら本人名、チームならチーム名） |
| team_id | text FK→team null | チーム参加時のみ |
| presentation_order | integer null | プレゼン順 |
| created_at | integer | |

#### entry_member（Entry に属するユーザー）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| entry_id | text FK→entry | |
| user_id | text FK→user | |
| is_leader | integer(bool) | チームリーダーフラグ（将来） |

- 個人参加モードでは Entry につき member は 1 人。
- **採点ロジックは「採点者の user が、対象 entry の entry_member に含まれるか」で自己採点を判定する。** これにより個人・チームで分岐不要。

#### submission（成果物）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| entry_id | text FK→entry unique | |
| presentation_url | text null | プレゼン資料 URL |
| source_code_url | text null | ソースコード URL |
| updated_at | integer | |

#### scoring_criterion（採点項目）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| name | text | 例: 技術力、独自性 |
| description | text null | |
| sort_order | integer | 表示順 |
| max_level | integer | 段階数（デフォルト 4） |

- **デフォルト採点項目テンプレ**を用意（技術力 / 独自性 / 完成度 / プレゼン）。イベント作成時にコピー投入。

#### score（採点）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| entry_id | text FK→entry | 採点対象 |
| criterion_id | text FK→scoring_criterion | |
| judge_user_id | text FK→user | 採点者 |
| value | integer | 1〜max_level |
| updated_at | integer | |

- unique(entry_id, criterion_id, judge_user_id) … 採点者ごとに 1 セル。upsert で**採点の修正**に対応。

#### award_rank（ランキングの賞）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| name | text | 例: 最優秀賞、優秀賞 |
| content | text null | 賞の内容・賞品など |
| rank_order | integer | 上位ほど小さい値。**ドラッグで並べ替え**→この値を更新 |
| ranking_label | text null | ランキングの名前（賞グループの呼称） |

- **テンプレ**: デフォルトで 1〜3 位を投入。CRUD 可能。

#### special_award（ランキング外の特別枠）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| name | text | 例: 特別賞、オーディエンス賞 |
| content | text null | |
| sort_order | integer | |

- 複数設定可能。集計モードでスタッフ／審査員が受賞 Entry を選ぶ。

#### award_result（受賞結果）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| entry_id | text FK→entry | |
| award_rank_id | text FK→award_rank null | ランキング賞の場合 |
| special_award_id | text FK→special_award null | 特別枠の場合 |
| revealed | integer(bool) | 表彰モードで発表済みか |

#### event_state（イベントの進行状態）★リアルタイムの核
| カラム | 型 | 説明 |
|--------|----|------|
| event_id | text PK FK→event | |
| mode | text | `normal` / `presentation` / `aggregation` / `awards` |
| presenting_entry_id | text FK→entry null | プレゼン中の Entry |
| scoring_locked | integer(bool) | 集計締切フラグ |
| awards_reveal_cursor | integer null | 表彰の発表進行位置 |
| updated_at | integer | |

- このテーブルの変更を SSE で全クライアントに通知する。

#### team（将来）
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | |
| event_id | text FK→event | |
| name | text | |
| leader_user_id | text FK→user | |
| created_at | integer | |

- チーム機能実装時に有効化。`entry.team_id` で Entry と接続。

#### session
| カラム | 型 | 説明 |
|--------|----|------|
| id | text PK | セッション ID（Cookie に保存） |
| user_id | text FK→user | |
| expires_at | integer | |

---

## 5. 認証（Discord OAuth2）

### フロー
1. クライアントが `GET /api/auth/discord/login` にアクセス。
2. サーバーが state を生成しセッション/Cookie に保存、Discord 認可 URL へリダイレクト。
3. ユーザーが Discord で承認 → `GET /api/auth/discord/callback?code=&state=` に戻る。
4. サーバーが state を検証し、code をトークンに交換、Discord `/users/@me` でプロフィール取得。
5. `user` を upsert（discord_id をキー）、`session` を発行し HttpOnly・Secure・SameSite=Lax Cookie をセット。
6. SPA のトップへリダイレクト。

### セッション
- セッション ID は HttpOnly Cookie。サーバー側 `session` テーブルで管理（失効・ログアウトを制御）。
- `GET /api/auth/me` で現在のユーザーを返す。未ログインは 401。
- ミドルウェアで保護ルートにセッション検証を適用。

### 必要な環境変数
```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://<tunnel-domain>/api/auth/discord/callback
SESSION_SECRET=
DATABASE_URL=file:./data/eventer.db
APP_BASE_URL=https://<tunnel-domain>
```

---

## 6. ロール・権限設計

ロールは `event_member.role` に保持し、**イベントごとに付与**。

| ロール | 主な権限 |
|--------|----------|
| `participant`（参加者） | 自分の Entry の成果物編集、イベント参加/解除、プレゼン中の採点（イベント設定により制限） |
| `staff`（スタッフ） | モード切替、プレゼン対象の制御、集計プレビュー/締切、表彰進行、採点（任意）、参加者・採点項目・表彰の管理委譲 |
| `judge`（審査員） | 採点、特別枠の選定 |
| `observer`（観覧者） | 閲覧のみ。採点不可 |
| イベント作成者 / 管理者 | イベント CRUD、メンバーのロール割当、採点項目・表彰設定の管理 |

- 権限チェックはサーバーミドルウェアで「event_id + 必要ロール」を検証する `requireRole(eventId, roles)` で実装。
- **自己採点の制限**: `event.aggregate_self_entry` が false の場合、採点者が対象 Entry の member であれば採点 API を 403、UI でも採点不可にする。

---

## 7. API 設計（主要エンドポイント）

> すべて `/api` 配下。入出力は `packages/shared` の Zod スキーマで型共有。

### 認証
- `GET  /api/auth/discord/login`
- `GET  /api/auth/discord/callback`
- `POST /api/auth/logout`
- `GET  /api/auth/me`

### イベント
- `GET  /api/events` … 一覧（公開中 / 自分が参加）
- `POST /api/events` … 作成（管理者）
- `GET  /api/events/:id`
- `PATCH /api/events/:id`
- `POST /api/events/:id/publish`

### マイページ
- `GET /api/me/events` … 開催中 / 過去参加 / 所属チーム をまとめて返す

### 参加・メンバー
- `POST   /api/events/:id/join` … 参加登録（Entry を個人モードで自動生成）
- `DELETE /api/events/:id/join` … 参加解除
- `GET    /api/events/:id/members` … 参加者一覧（ロール付き）
- `PATCH  /api/events/:id/members/:userId/role` … ロール変更（管理者）

### Entry / 成果物
- `GET   /api/events/:id/entries`
- `GET   /api/events/:id/entries/:entryId`
- `PUT   /api/events/:id/entries/:entryId/submission` … 成果物 URL の保存
- `GET   /api/events/:id/submissions` … 成果物集約ページ用（オンライン時）

### 採点項目
- `GET    /api/events/:id/criteria`
- `POST   /api/events/:id/criteria` （テンプレ流用 / 個別追加）
- `PATCH  /api/events/:id/criteria/:cid`
- `DELETE /api/events/:id/criteria/:cid`

### 採点
- `GET  /api/events/:id/scores/mine` … 自分の採点状況
- `PUT  /api/events/:id/scores` … upsert（entry_id, criterion_id, value）
- `GET  /api/events/:id/scores/summary` … 集計（権限: staff/judge、締切前はプレビュー）
- `GET  /api/events/:id/scores/progress` … 誰が未入力か（staff）

### 表彰設定
- `GET/POST/PATCH/DELETE /api/events/:id/award-ranks`
- `PATCH /api/events/:id/award-ranks/reorder` … ドラッグ並べ替え（rank_order 一括更新）
- `GET/POST/PATCH/DELETE /api/events/:id/special-awards`
- `PUT  /api/events/:id/award-results` … 特別枠/ランキングの受賞 Entry 確定

### 進行（モード）
- `GET   /api/events/:id/state`
- `PATCH /api/events/:id/state/mode` … モード切替（staff）
- `PATCH /api/events/:id/state/presenting` … プレゼン対象変更（staff）
- `POST  /api/events/:id/state/scoring-lock` … 集計締切（staff）
- `POST  /api/events/:id/state/awards-advance` … 表彰を 1 段階進める（staff）

### SSE
- `GET /api/events/:id/stream` … イベント状態のリアルタイム購読

---

## 8. リアルタイム（SSE 設計）

### SSE ハブ
- サーバーは `event_id` ごとに購読者（接続）の集合を管理する `SseHub` を持つ。
- 状態変更 API（モード切替、プレゼン対象、採点提出、表彰進行）が成功したら、該当イベントの全購読者へイベントを push。

### 送信イベント種別
| event 名 | データ | 用途 |
|----------|--------|------|
| `state` | event_state スナップショット | モード／プレゼン対象／締切／表彰カーソルの変更 |
| `score-progress` | { entryId, judgeUserId } | 採点提出を検知し「未入力者」表示を更新 |
| `awards-reveal` | { rank/special, entryId } | 表彰の段階発表 |

### クライアント挙動
- イベントページを開くと `EventSource` で `/stream` を購読。
- `state` 受信時、`mode` が `presentation` に変わったら**参加者画面を強制的にプレゼン中画面へ切替**（Zustand のモードストアを更新→ルーティングをガード）。
- 切断時は自動再接続（EventSource 標準）。再接続後は `GET /state` で最新を取り直す。

---

## 9. 画面設計（ルーティング）

```
/                         … ランディング / ログイン
/login                    … Discord ログインボタン
/me                       … マイページ（開催中・過去参加・所属チーム）
/events                   … イベント一覧
/events/:id               … イベント詳細（内容/参加登録/参加者一覧/成果物）
/events/:id/submissions   … 成果物集約（オンライン時）
/events/:id/present       … プレゼン中画面（モード連動で強制遷移）
/events/:id/scoring       … 採点画面（審査員/スタッフ）
/events/:id/awards        … 表彰画面（演出付き）

# 管理（スタッフ/管理者）
/admin/events             … イベント管理一覧
/admin/events/new         … 作成
/admin/events/:id         … 設定（基本情報）
/admin/events/:id/members … 参加者・ロール管理
/admin/events/:id/criteria… 採点項目管理
/admin/events/:id/awards  … 表彰設定（賞 CRUD・ドラッグ並べ替え）
/admin/events/:id/control … 進行コントロール（モード切替・プレゼン制御・集計・表彰進行）
```

### 主要画面の要点
- **マイページ**: 開催中イベント / 過去参加イベント / 所属チーム（将来）の 3 セクション。
- **イベント詳細**: 内容表示、参加登録・解除ボタン、参加者一覧、成果物（自分の Entry の URL 編集）。
- **プレゼン中画面**: 中央に発表中の Entry 名・成果物、右ペインに採点項目（4 段階の入力）。発表中も採点・修正可能。
- **採点画面**: Entry × 採点項目のグリッド。自己 Entry はイベント設定により非活性。
- **表彰画面**: チーム名・合計点・**各項目合計のレーダーチャート**を表示。下位の賞から段階発表、ランクごとに**ドラムロール音＋エフェクト**を選択可能。

---

## 10. モード設計（状態遷移）

`event_state.mode` で制御。スタッフが遷移させる。

```
        ┌─────────┐  staff   ┌──────────────┐  staff   ┌──────────────┐  staff   ┌─────────┐
        │ normal  │ ───────▶ │ presentation │ ───────▶ │ aggregation  │ ───────▶ │ awards  │
        └─────────┘          └──────────────┘          └──────────────┘          └─────────┘
             ▲                       │                         │                       │
             └───────────────────────┴─────────────────────────┴───────────────────────┘
                              （staff は任意に normal へ戻せる）
```

### 各モードの振る舞い
| モード | 振る舞い |
|--------|----------|
| `normal` | 通常表示。準備・閲覧。 |
| `presentation` | プレゼン中。`presenting_entry_id` を SSE 配信。参加者は強制的にプレゼン中画面へ。右ペインで採点・修正可。スタッフも任意で採点可。`aggregate_self_entry=false` なら自己 Entry の採点不可。 |
| `aggregation` | スタッフが `scoring_locked` にするまで採点継続可。スタッフは集計プレビューと**未入力者一覧**を確認。特別枠があればスタッフ／審査員が受賞 Entry を選定。 |
| `awards` | 下位の賞から段階発表（`awards_reveal_cursor` を進める）。特別枠はランキング発表後。各段階で `awards-reveal` を SSE 配信し、演出（ドラムロール音・エフェクト）を再生。 |

---

## 11. 採点・集計ロジック

- 各 `score` は (entry, criterion, judge) で一意。値は 1〜max_level（既定 4）。
- **Entry 合計点** = 全採点者・全項目の value 合計。
- **項目別合計**（レーダーチャート用）= 項目ごとに全採点者の value 合計。
- **集計方針** `aggregate_self_entry`:
  - false: 採点者が対象 Entry の member の場合、その score を集計から除外（かつ入力もブロック）。
  - true: 自己 Entry への採点も集計に含める。
- **未入力検知**: 期待採点者（judge ＋ 設定により staff/participant）× 対象 Entry × 項目 の母集合に対し、未登録セルを持つ採点者を「未入力者」として列挙。
- ランキングは合計点降順。同点時の扱い（タイブレーク）は MVP では同順位表示、必要に応じてスタッフ手動調整を後続検討。

---

## 12. 表彰機能

- **ランキング賞** (`award_rank`): テンプレで 1〜3 位を初期投入。CRUD 可。`rank_order` をドラッグ並べ替えで更新。`ranking_label` でランキング名を設定。
- **特別枠** (`special_award`): ランキング外。複数設定可。集計モードで受賞 Entry を選定。
- **表彰モード**: `awards_reveal_cursor` を進めて下位ランクから順に発表。特別枠はランキング発表後。発表内容はチーム名・合計点・項目別レーダーチャート。
- **演出**: ランクごとにドラムロール音・エフェクトのプリセットを選択可能（フロント側で設定を持ち、表彰段階で再生）。

---

## 13. フェーズ分割

### フェーズ 1（MVP・最初に作る）
- Discord OAuth ログイン / セッション
- イベント CRUD（基本情報、会場種別、公開）
- 参加登録・解除（Entry 個人モード自動生成）
- 参加者一覧・ロール管理
- マイページ（開催中・過去参加）
- 成果物（プレゼン資料 / ソースコード URL）
- → **「参加できる状態」を達成**

### フェーズ 2（当日運営）
- 採点項目管理（テンプレ + CRUD）
- 採点（プレゼンモード／採点画面、自己採点制限）
- 進行モード切替 + SSE
- 集計プレビュー・未入力検知・締切

### フェーズ 3（表彰）
- 表彰設定（ランキング賞 CRUD・ドラッグ並べ替え・特別枠）
- 表彰モード（段階発表・レーダーチャート・演出）
- 成果物集約ページ（オンライン）

### フェーズ 4（将来）
- チーム参加（team / entry_member 拡張、チーム作成・リーダー）
- スライド連動表示（WebSocket 検討）
- アンケート機能（オフライン会場の大型 QR コード表示）

---

## 14. 今後の検討事項 / 留意点

- **タイブレーク**ルール（同点時の順位確定方法）。
- **採点の重み付け**（審査員とスタッフで重みを変えるか）。
- チーム移行時の **Entry 再編成 UI**（個人 Entry をチーム Entry へ統合する操作）。
- スライド連動・大規模同時接続が必要になった場合の **WebSocket / 外部 PubSub** 導入。
- SQLite の同時書き込み制約 → 採点ピーク時に **WAL モード**を有効化（`PRAGMA journal_mode=WAL`）。DB 移行は行わない方針。
- Cloudflare Tunnel 越しの **SSE 長時間接続**の安定性（タイムアウト・keep-alive 設定）。

---

## 付録: デフォルトテンプレート

### 採点項目テンプレ（4 段階）
| 項目 | 説明 |
|------|------|
| 技術力 | 実装の難易度・完成度 |
| 独自性 | アイデアの新規性 |
| 完成度 | 動作・仕上がり |
| プレゼン | 発表のわかりやすさ |

### 表彰テンプレ
| rank_order | name |
|-----------|------|
| 1 | 最優秀賞 |
| 2 | 優秀賞 |
| 3 | 審査員特別賞 |
