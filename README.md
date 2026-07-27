# events lab

**募集から配信まで全部やる、イベント運営ツール。**

events lab は、アイディアソン／ハッカソンに限らず、あらゆるイベントの告知・参加募集・日程調整・当日の進行・採点・表彰までを一つで回せるイベント運営プラットフォームです。将来的には「会場を提供したい人」と「イベントを開きたい人」をつなぐマッチング、参加履歴をまとめたポートフォリオ、実績（アチーブメント）、ネイティブアプリまでを目指します。

公開URL: https://events.kojira.io

## コンセプト

- **イベント運営のワンストップ化** — 募集から進行・採点・表彰まで分断なく。
- **種類を問わない** — ハッカソンに限らず、勉強会・交流会・コンテストなど汎用的に。
- **当日がいちばん楽しい** — プレゼン・採点・集計・表彰をリアルタイム演出付きで。
- **続けるほど価値が貯まる** — 参加・運営の履歴や受賞がポートフォリオ／実績になる。

## 技術スタック

- フロント: React + Vite + MUI（TypeScript）
- バックエンド: Hono on **Cloudflare Workers**（単一 Worker が SPA 配信・OG 注入・API を担当）
- DB: **Cloudflare D1**（SQLite）+ 自前の薄いリポジトリ層 ／ 画像: **R2**
- 認証: Discord / Google / GitHub OAuth2 + **Nostr NIP-07**（複数連携可）、セッション Cookie
- リアルタイム: 2秒ポーリング（進行モード・採点状況の同期）
- デプロイ: GitHub Actions（`staging` / `production` ブランチへの push で wrangler deploy）
- モノレポ: pnpm workspace（`apps/web` / `apps/server` / `packages/shared`）、TypeScript 7

当初の設計ドキュメントは `docs/design.md`（冒頭に現在の実装との差分あり）、デザインルールは `DESIGN.md`。

## ロードマップ / 実装状況

### ✅ 実装済み

- [x] ログイン（Discord / Google / GitHub / Nostr NIP-07。複数連携・連携解除・引き取り）
- [x] イベントの作成・編集・削除、公開／非公開、Markdown 説明文
- [x] イベント画像のアップロード（OG サイズにクロップ・WebP 保存）と OG メタ注入
- [x] 短いシェア URL（`/e/:slug`）
- [x] 公開トップ：開催中・開催予定・日程調整中・過去イベントの一覧（未ログイン閲覧可）
- [x] **日程調整**（候補日に○△×で回答、参加最多ハイライト、曜日・日本の祝日表示、確定で開催日時に反映＋回答者へ通知、確定後の結果表示は主催者がオンオフ可）
- [x] 参加登録・解除、参加者一覧、参加枠（複数枠・定員・先着順／抽選・抽選日時・手動当落）
- [x] キャンセル待ちの自動繰り上げ（先着枠）
- [x] マイページ・アカウント設定（ログイン方法の連携管理・ハンドル変更）
- [x] 公開ユーザープロフィール（`/users/:id`）
- [x] コミュニティ（`/c/:slug`。アイコン／バナー、所属イベント一覧）
- [x] スライド（デッキ）の作成・編集・公開（`/d/:slug`。画像・テキスト配置）
- [x] アプリ内通知（抽選結果・繰り上げ・受賞・問い合わせ・日程確定）
- [x] 問い合わせ（ユーザー⇔運営のスレッド）
- [x] 成果物の登録（プレゼン資料 URL・ソースコード URL）
- [x] イベントごとのロール（参加者／スタッフ／審査員／観覧者）＋アプリ運営管理者
- [x] 採点項目の管理、採点（参加者全員が採点可・自己採点の制限・修正可）
- [x] 集計プレビュー・採点進捗・締切、進行モード（通常／プレゼン／集計／表彰）
- [x] 表彰設定（ランキング賞・特別枠の CRUD・並べ替え・受賞者割当）と表彰式演出
- [x] staging 環境（ログイン必須ゲート）と CI/CD、セキュリティ強化一式

### 🚧 これから

- [ ] 写真サムネの最適化: ギャラリー一覧は Cloudflare Image Transformations（Worker の `cf.image` で幅指定してproxy取得、月5000変換まで無料・エッジキャッシュあり）で小さい版を配信し、原本フル画像の読み込みを避ける。拡大時のみ原本。
- [ ] チーム参加（チーム作成・リーダー・チーム単位の採点／成果物）
- [ ] スライドとイベント進行の同期（プレゼンモード連動）
- [ ] ブラウザから直接ライブ配信（WebRTC）。リモート視聴・観覧モードまで events lab 内で完結
- [ ] アンケート機能（オフライン会場向けの大きな QR コード表示）
- [ ] アチーブメント（例: イベント10回運営／初イベント頓挫／100人と交流 など多数の実績バッジ）
- [ ] 会場マッチング（会場提供者の会場登録、無料／有料などの利用条件設定）
- [ ] イベント運営者からの「会場募集」掲載とマッチング
- [ ] ネイティブアプリ（iOS / Android）

## 開発

```bash
pnpm install
pnpm --filter @eventer/server exec wrangler d1 migrations apply eventer --local  # 初回とスキーマ更新時
pnpm dev   # web: vite (127.0.0.1:4280) + API: wrangler dev (:8787、vite が /api を proxy)
```

- ローカルの環境変数はリポジトリ直下の `.dev.vars`（gitignore 済）。`ENVIRONMENT=development` にすると開発用ログイン（dev-login）が使える。
- シークレット（OAuth クレデンシャル・SESSION_SECRET）は `wrangler secret put` で登録し、リポジトリには入れない。

## デプロイ

GitHub Actions（`.github/workflows/deploy.yml`）がブランチ連動でデプロイします。

```bash
git push origin main:staging      # → staging (https://eventer-staging.kojiran.workers.dev、ログイン必須)
git push origin main:production   # → 本番 (https://events.kojira.io)。staging 確認後に実行
```

マイグレーションはデプロイ前に手動で適用します。

```bash
cd apps/server
pnpm exec wrangler d1 migrations apply eventer-staging --remote --env staging  # staging
pnpm exec wrangler d1 migrations apply eventer --remote                        # 本番
```
