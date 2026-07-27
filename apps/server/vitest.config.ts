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
          // ルートの wrangler.toml から D1 / R2 / ASSETS バインディングを取得
          wrangler: { configPath: path.join(here, "../../wrangler.toml") },
          miniflare: {
            compatibilityDate: "2025-05-01",
            compatibilityFlags: ["nodejs_compat"],
            // テスト用の環境変数（本番 vars を上書き）。development で dev-login 有効
            bindings: {
              TEST_MIGRATIONS: migrations,
              ENVIRONMENT: "development",
              APP_BASE_URL: "http://localhost",
              SESSION_SECRET: "test-secret",
              ADMIN_DISCORD_IDS: "dev-user",
            },
          },
        },
      },
    },
  };
});
