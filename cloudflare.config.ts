import { bindings, defineConfig, triggers } from "cf/config";

/**
 * cf 用のプロジェクト設定。CI のデプロイ（staging / production）は cf が読み、
 * ローカル開発・テスト・D1 のマイグレーションは今までどおり wrangler が wrangler.toml を読む。
 * 2つは独立していて、assets のディレクトリだけ wrangler.config.ts に置く。
 *
 * 環境の切り替えは wrangler の `--env staging` ではなく `cf deploy --mode staging`。
 * `--mode production` とモード無しは、どちらも下の default（本番相当）を選ぶ。
 *
 * cf は pnpm workspace のルートでは動かない（「application detection logic has been run
 * in the root of a workspace」）ため、pnpm-workspace.yaml の packages に "." を入れて
 * ルート自身をワークスペースの1プロジェクトとして扱わせている。
 *
 * D1 の migrations_dir は cf の設定に持てない。マイグレーションは今までどおり
 * `wrangler d1 migrations apply`、または `cf d1 migrations apply <database-id> --dir apps/server/migrations`
 * で流す（CI のデプロイはマイグレーションを流さない）。
 *
 * 参照: https://developers.cloudflare.com/cf/projects/cloudflare-config/
 */
export default defineConfig((ctx) => {
  switch (ctx.mode) {
    case "staging": {
      return {
        accountId: "b9cec3916d500760a7c7b9c31c720d80",
        worker: {
          name: "eventer-staging",
          compatibilityDate: "2025-05-01",
          compatibilityFlags: ["nodejs_compat", "cache_no_cache_enabled"],
          entrypoint: "apps/server/src/worker.ts",
          workersDev: true,
          // staging はカスタムルートを使わず workers.dev のみ（本番ルートの継承を打ち消す）。
          // cf では triggers を書かなければルートは付かない
          assets: {
            notFoundHandling: "single-page-application",
            runWorkerFirst: true,
          },
          env: {
            ENVIRONMENT: bindings.text("staging"),
            APP_BASE_URL: bindings.text("https://eventer-staging.kojiran.workers.dev"),
            ADMIN_DISCORD_IDS: bindings.text("390732846236434452"),
            DISCORD_REDIRECT_URI: bindings.text(
              "https://eventer-staging.kojiran.workers.dev/api/auth/discord/callback",
            ),
            DB: bindings.d1({
              name: "eventer-staging",
              id: "389e4625-8e13-4a41-9530-3ab3be10cee5",
            }),
            BUCKET: bindings.r2({
              name: "eventer-images-staging",
            }),
            ASSETS: bindings.assets(),
          },
        },
      };
    }
    // 本番。wrangler.toml のトップレベル（[env.production] は無い）がそのまま本番の設定
    case "production":
    default: {
      return {
        accountId: "b9cec3916d500760a7c7b9c31c720d80",
        worker: {
          name: "eventer",
          compatibilityDate: "2025-05-01",
          compatibilityFlags: ["nodejs_compat", "cache_no_cache_enabled"],
          entrypoint: "apps/server/src/worker.ts",
          workersDev: true,
          assets: {
            notFoundHandling: "single-page-application",
            runWorkerFirst: true,
          },
          // 本番ドメイン: Worker ルートでエッジ処理（既存DNSを触らずトンネルを上書き）。
          // DNS は events.kojira.io の CNAME（旧トンネル）をそのまま残してよい
          triggers: [
            triggers.fetch({
              pattern: "events.kojira.io/*",
              zone: "kojira.io",
            }),
          ],
          env: {
            ENVIRONMENT: bindings.text("production"),
            APP_BASE_URL: bindings.text("https://events.kojira.io"),
            ADMIN_DISCORD_IDS: bindings.text("390732846236434452"),
            DISCORD_REDIRECT_URI: bindings.text(
              "https://events.kojira.io/api/auth/discord/callback",
            ),
            DB: bindings.d1({
              name: "eventer",
              id: "977fc3ef-3806-48fe-9019-918f54989279",
            }),
            BUCKET: bindings.r2({
              name: "eventer-images",
            }),
            ASSETS: bindings.assets(),
          },
        },
      };
    }
  }
});
