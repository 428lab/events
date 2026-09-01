# events lab

**募集から配信まで全部やる、イベント運営ツール。**

events lab は、アイディアソン／ハッカソンに限らず、あらゆるイベントの告知・参加募集・日程調整・当日の進行・採点・表彰までを一つで回せるイベント運営プラットフォームです。将来的には「会場を提供したい人」と「イベントを開きたい人」をつなぐマッチングの拡充、参加履歴をまとめたポートフォリオ、ネイティブアプリまでを目指します。

公開URL: https://events.kojira.io

## コンセプト

- **イベント運営のワンストップ化** — 募集から進行・採点・表彰まで分断なく。
- **種類を問わない** — ハッカソンに限らず、勉強会・交流会・コンテストなど汎用的に。
- **当日がいちばん楽しい** — プレゼン・採点・集計・表彰をリアルタイム演出付きで。
- **続けるほど価値が貯まる** — 参加・運営の履歴や受賞がポートフォリオ／実績になる。

## 技術スタック

- フロント: React + Vite + MUI（TypeScript）
- バックエンド: Hono on **Cloudflare Workers**（単一 Worker が SPA 配信・OG 注入・API を担当）
- DB: **Cloudflare D1**（SQLite）+ 自前の薄いリポジトリ層 ／ 画像・動画: **R2**
- 認証: Discord / Google / GitHub / X OAuth2 + **Bluesky (OAuth)** + **Nostr NIP-07**（複数連携可）、セッション Cookie
- リアルタイム: 短周期ポーリング（採点 2秒・配信 1秒・投影／タイムテーブル 5秒 など）
- デプロイ: GitHub Actions（`staging` / `production` ブランチへの push で wrangler deploy）
- モノレポ: pnpm workspace（`apps/web` / `apps/server` / `packages/shared`）、TypeScript 7

当初の設計ドキュメントは `docs/design.md`（冒頭に現在の実装との差分あり）、デザインルールは `DESIGN.md`。機能ごとの設計は[設計ドキュメント](#設計ドキュメント)を参照。

## ロードマップ / 実装状況

### ✅ 実装済み

#### アカウント・認証

- [x] ログイン（Discord / Google / GitHub / X / Bluesky / Nostr NIP-07。複数連携・連携解除・引き取り）
- [x] マイページ・アカウント設定（ログイン方法の連携管理・ハンドル変更）
- [x] 公開ユーザープロフィール（`/users/:id`。タブ分け・メディア一覧・プロフィールカード `/users/:id/card`）
- [x] 多言語対応（日本語・英語）

#### イベント運営

- [x] イベントの作成・編集・削除、公開／非公開、Markdown 説明文
- [x] イベント画像のアップロード（OG サイズにクロップ・WebP 保存）と OG メタ注入、短いシェア URL（`/e/:slug`）
- [x] 公開トップ：開催中・開催予定・日程調整中・過去イベントの一覧（未ログイン閲覧可）、RSS / JSON Feed / iCalendar 配信
- [x] **日程調整**（候補日に○△×で回答、参加最多ハイライト、曜日・日本の祝日表示、確定で開催日時に反映＋回答者へ通知、確定後の結果表示は主催者がオンオフ可）
- [x] 参加登録・解除、参加者一覧、参加枠（複数枠・定員・先着順／抽選・抽選日時・手動当落）、キャンセル待ちの自動繰り上げ（先着枠）
- [x] **開催前アンケート**（トークン URL `/s/:token` で回答、表ビュー・CSV・日毎アクセス数、[docs/pre-event-survey.md](docs/pre-event-survey.md)）
- [x] 参加アンケート（参加申込時に回答・後から編集可。回答は参加者名簿の CSV に含まれる）
- [x] タイムテーブル（当日の進行表。参加者向け表示と編集）
- [x] イベントごとのロール（参加者／スタッフ／審査員／観覧者）＋アプリ運営管理者
- [x] 採点項目の管理、採点（参加者全員が採点可・自己採点の制限・修正可）
- [x] 集計プレビュー・採点進捗・締切、進行モード（通常／プレゼン／集計／表彰）
- [x] 表彰設定（ランキング賞・特別枠の CRUD・並べ替え・受賞者割当）と表彰式演出
- [x] 成果物の登録（プレゼン資料 URL・ソースコード URL）
- [x] 「イベントのたまご」（あったらいいな投稿→賛同→イベントに孵化。短い URL `/r/:slug`）

#### 参加者体験

- [x] チェックイン（QR コードで当日受付）
- [x] 出会いの記録（QR を見せ合って交流を記録・XP 獲得）と出会いランキングのリアルタイム投影（[docs/meet-ranking.md](docs/meet-ranking.md)）
- [x] **景品**（達成条件クリアで引き換え、スタッフの引き換えデスク、[docs/meet-prizes.md](docs/meet-prizes.md)）
- [x] **数字ビンゴ**（参加者カード・スタッフの抽選コントロール・投影画面、[docs/bingo.md](docs/bingo.md)）と成績履歴・受け取りログ（[docs/bingo-history.md](docs/bingo-history.md)）
- [x] アチーブメント（XP・レベル・バッジ、プロフィールの参加実績）
- [x] 写真・動画の投稿（イベントギャラリー。動画はブラウザ内エンコード）
- [x] アプリ内通知（抽選結果・繰り上げ・受賞・問い合わせ・日程確定）。受け取ったお知らせは一覧ページで読み直せる（本文全文・既読／未読・ページ送り）
- [x] 問い合わせ（ユーザー⇔運営のスレッド）

#### 会場・配信

- [x] 会場登録・会場一覧（会場提供者が登録し、主催者とオファーでつながる）
- [x] イベントからの「会場を探しています」掲載とオファーのやりとり
- [x] スライド（デッキ）の作成・編集・公開（`/d/:slug`。画像・テキスト配置）
- [x] 配信セットと配信画面（OBS がウィンドウキャプチャする完成画面・配信コントロール・BGM）
- [x] イベントチャット（Nostr リレー経由。投影画面あり）

#### スタッフ運用

- [x] スタッフ招待、スタッフ用チャット（暗号化。[docs/staff-chat.md](docs/staff-chat.md)）
- [x] スタッフ用タイムライン（準備・片付け・裏方トラック。[docs/staff-timeline.md](docs/staff-timeline.md)）
- [x] 役割タグと持ち場の割り当て（時間帯 × 役割 × 人数。[docs/staff-roles.md](docs/staff-roles.md)）
- [x] TODO リストとガントチャート（準備の段取り。[docs/staff-todo.md](docs/staff-todo.md)）
- [x] **一斉連絡**（スタッフが区分を選んで参加者へお知らせ。アプリ内通知は即時、メールは順次送信。送信状況と履歴はスタッフのみ閲覧）
- [x] 名札印刷、参加者名簿の CSV 出力

#### ソーシャル・コミュニティ

- [x] フォロー、いいね、イベントコメント、Q&A
- [x] コミュニティ（`/c/:slug`。アイコン／バナー、所属イベント一覧、メンバー一覧、KPI）

#### 管理者・運営基盤

- [x] 管理者ページ（統計・KPI・トレンド・設定・監査ログ・不正利用対策・モデレーション・問い合わせ対応）
- [x] メール通知（Resend）と前日リマインダー、閲覧数の計測（後述）
- [x] staging 環境（ログイン必須ゲート）と CI/CD、セキュリティ強化一式

### 🚧 これから

- [ ] 写真サムネの最適化: ギャラリー一覧は Cloudflare Image Transformations（Worker の `cf.image` で幅指定してproxy取得、月5000変換まで無料・エッジキャッシュあり）で小さい版を配信し、原本フル画像の読み込みを避ける。拡大時のみ原本。
- [ ] チーム参加（チーム作成・リーダー・チーム単位の採点／成果物）
- [ ] スライドとイベント進行の同期（プレゼンモード連動）
- [ ] ブラウザから直接ライブ配信（WebRTC）。リモート視聴・観覧モードまで events lab 内で完結
- [ ] ネイティブアプリ（iOS / Android）

## 開発

```bash
pnpm install
cp .dev.vars.example .dev.vars   # ローカルの環境変数（.dev.vars は gitignore 済）
pnpm migrate:local               # 初回とスキーマ更新時（リポジトリ直下で実行）
pnpm dev   # web: vite (127.0.0.1:4280) + API: wrangler dev (:8787、vite が /api を proxy)
```

- ローカルの環境変数はリポジトリ直下の `.dev.vars`。`ENVIRONMENT=development` にすると開発用ログイン（dev-login）が使える。
- シークレット（OAuth の client id / secret: Discord・Google・GitHub・X、SESSION_SECRET）は `wrangler secret put` で登録し、リポジトリには入れない。アプリ運営管理者の指定は環境変数 `ADMIN_DISCORD_IDS`（`wrangler.toml` の `[vars]` ／ ローカルは `.dev.vars`）。
- Bluesky ログインをローカルで試すときは、**ブラウザを `http://127.0.0.1:4280` で開く**こと（`localhost` で開くと、認可後に戻ったときに cookie のオリジンが違ってセッションが繋がらない）。シークレットの設定は不要です。詳細は `docs/bluesky-login.md` の9章。

## デプロイ

GitHub Actions（`.github/workflows/ci.yml`）がブランチ連動でデプロイします。型チェックとテストは同じワークフローで、すべての PR に対しても走ります。

```bash
git push origin main:staging      # → staging (https://eventer-staging.kojiran.workers.dev、ログイン必須)
git push origin main:production   # → 本番 (https://events.kojira.io)。staging 確認後に実行
```

マイグレーションはデプロイ前に手動で適用します（`wrangler.toml` はリポジトリ直下のみ。**リポジトリ直下で実行**）。

```bash
pnpm exec wrangler d1 migrations apply eventer-staging --env staging --remote  # staging
pnpm exec wrangler d1 migrations apply eventer --remote                        # 本番
```

### メール通知（Resend）

メール通知（#126）は [Resend](https://resend.com) の HTTP API で送信します。

- Resend のダッシュボードで送信ドメイン `kojira.io` を検証（DNS に SPF/DKIM レコードを追加）しておく。
- API キーをシークレットとして登録する（未設定の環境ではメール送信は自動で無効になる）。

```bash
npx wrangler secret put RESEND_API_KEY                 # 本番
npx wrangler secret put RESEND_API_KEY --env staging   # staging
```

- 差出人は既定で `events lab <noreply@events.kojira.io>`（Resend で認証済みのドメインに合わせる）。変える場合は環境変数 `EMAIL_FROM` を設定。
- 前日リマインダーは cron トリガー（毎日 UTC 0:00 = JST 9:00）で送信される。
- 一斉連絡（#172）のメールは送信待ちに積まれ、GitHub Actions の定時実行
  （`.github/workflows/broadcast-emails.yml`。5分おき）が
  `POST /api/cron/broadcast-emails` を叩いて順次送信する。1回で送れるのは
  1リクエストのメール送信予算ぶん（20通）までで、残りは次の実行が続きから送る
  （実測で約 240通/時。100人で約25分、300人で約1時間15分）。
  送信待ちが複数の連絡にまたがるときは連絡どうしで枠を分け合うので、
  大人数の連絡が別イベントの連絡を待たせ続けることはない。
  レート超過や 5xx のような一時的な失敗では再試行回数を消費せず、間隔を空けて
  丸1日ぶんまで粘る。それでも送れなかったぶんはスタッフが一斉連絡の画面から
  送り直せる（送信回数の上限は消費しない）。
  `CRON_SECRET` 未設定のリポジトリでは定時実行は呼び出さずに正常終了する。
  staging には定時実行を張らないため、動作確認は
  `POST /api/admin/run-broadcast-emails`（アプリ運営管理者のみ）で行う。

### 閲覧数の計測（WEB_ANALYTICS_TOKEN）

どのページが見られているかは、ホスティング先が提供する計測をそのまま使います（#328）。
クッキーは使わず、外部の解析サービスにも渡さず、アプリのデータベースにも書きません。

- ホスティング先のダッシュボードで Web Analytics にサイト（`events.kojira.io`）を追加し、
  発行された識別子を GitHub のリポジトリシークレット `WEB_ANALYTICS_TOKEN` に登録する。
- **ダッシュボード側の自動挿入は使わない**（アプリが計測タグを自前で入れるため、
  両方が有効だと同じ閲覧が二重に数えられる）。サイト追加時に手動でスニペットを
  入れる設定を選ぶ。
- デプロイ時のフロントのビルドで `VITE_WEB_ANALYTICS_TOKEN` として埋め込まれる。
  **未設定のリポジトリでは計測タグを読み込まない＝計測は自動で無効。**
- 識別子は本番と staging で共通（ビルドは1回）。計測は識別子ごとに受け付けるため、
  staging のアクセスも同じサイトに混ざる可能性が高い。分けて見たいときは
  ダッシュボードでホスト名（`events.kojira.io`）で絞り込む。
- 画面遷移（React Router）も計測タグ側が拾う。遷移ごとの送信をアプリに書く必要はない。
- 分かるのはページ別の閲覧数・訪問数・流入元・国・端末／ブラウザ・表示速度。
  クエリ文字列は記録されない。個別の利用者の追跡や独自イベントの計測はできない。

### イベントチャットの公式サービス鍵（NOSTR_SERVICE_KEY）

Nostr イベントチャット（#199）のチャンネル作成（kind:40）は、主催者本人が
NIP-07 で署名する場合を除き、events lab の公式サービス鍵でサーバーが署名します
（参加者個人の鍵にはチャンネルを紐付けない）。秘密鍵は 64 桁 hex で、
環境（本番 / staging）ごとに別の鍵をシークレットとして登録します。

```bash
npx wrangler secret put NOSTR_SERVICE_KEY                 # 本番
npx wrangler secret put NOSTR_SERVICE_KEY --env staging   # staging
```

- 鍵は `node scripts/mine-npub.mjs <prefix>` で vanity npub をマイニングして作れる
  （出力の `hexsec:` の値をそのまま登録する。`nsec` 形式は受け付けないので注意）。
- 未設定の環境では公式署名エンドポイントは 503 (`service_key_unset`) を返し、
  主催者の NIP-07 経路以外ではチャンネルを作成できない。

## 設計ドキュメント

機能ごとの設計は `docs/` にあります。各ファイル冒頭のステータス（設計のみ／実装済み）は
作成時点のもので、その後実装が進んでいる場合があります。

| ドキュメント | 内容 |
| --- | --- |
| [docs/design.md](docs/design.md) | 当初の全体設計（冒頭に現在の実装との差分あり） |
| [docs/bingo.md](docs/bingo.md) | 数字ビンゴ（参加者カード・抽選コントロール・投影・景品条件） |
| [docs/bingo-history.md](docs/bingo-history.md) | ビンゴ成績履歴と受け取りログの可視化 |
| [docs/bluesky-login.md](docs/bluesky-login.md) | Bluesky でログイン・連携（トークンは保存しない） |
| [docs/meet-prizes.md](docs/meet-prizes.md) | 景品（達成条件つきの引き換え・スタッフの引き換えデスク） |
| [docs/meet-ranking.md](docs/meet-ranking.md) | 出会いランキングのリアルタイム投影 |
| [docs/notification-actor.md](docs/notification-actor.md) | 通知の actor を列として持つスキーマ変更 |
| [docs/pre-event-survey.md](docs/pre-event-survey.md) | 開催前アンケート（回答ページ・管理・導線） |
| [docs/profile-tabs.md](docs/profile-tabs.md) | プロフィールのタブ化とメディアのページング／フィルタ |
| [docs/staff-chat.md](docs/staff-chat.md) | スタッフ用チャットルーム（公開前から使える・暗号化） |
| [docs/staff-roles.md](docs/staff-roles.md) | スタッフの役割タグと持ち場（時間帯 × 役割 × 人数） |
| [docs/staff-timeline.md](docs/staff-timeline.md) | スタッフ用タイムライン（準備・片付け・裏方トラック） |
| [docs/staff-todo.md](docs/staff-todo.md) | スタッフ向け TODO リストとガントチャート |
| [docs/video-upload.md](docs/video-upload.md) | 動画投稿（ブラウザ内エンコード・Range 配信） |
