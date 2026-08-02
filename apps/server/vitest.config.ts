import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config"; // pool-workers 0.8.x
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineWorkersConfig(async () => {
  // apps/server/migrations の *.sql を読み、テスト用D1へ適用する
  const migrations = await readD1Migrations(path.join(here, "migrations"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          // wrangler.toml は読まない（assets.directory=apps/web/dist の存在チェックで
          // クリーン環境/CIが落ちるため）。ワーカー本体とバインディングを明示指定する。
          main: path.join(here, "src/worker.ts"),
          miniflare: {
            compatibilityDate: "2025-05-01",
            compatibilityFlags: ["nodejs_compat"],
            // ローカルの D1 / R2 をテスト用に用意（本番リソースには触れない）
            d1Databases: ["DB"],
            r2Buckets: ["BUCKET"],
            // OGメタ注入テスト用の最小アセット（index.html のみ）
            assets: {
              directory: path.join(here, "test/fixtures/assets"),
              binding: "ASSETS",
            },
            // テスト用の環境変数。development で dev-login 有効
            bindings: {
              TEST_MIGRATIONS: migrations,
              ENVIRONMENT: "development",
              APP_BASE_URL: "http://localhost",
              SESSION_SECRET: "test-secret",
              ADMIN_DISCORD_IDS: "dev-user",
              // X ログインの authorize リダイレクト（PKCE付与）検証用ダミー
              X_CLIENT_ID: "test-x-client",
              X_CLIENT_SECRET: "test-x-secret",
              // cron エンドポイント (#129) の検証用
              CRON_SECRET: "test-cron-secret",
            },
          },
        },
      },
    },
  };
});
