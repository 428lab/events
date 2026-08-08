import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config"; // pool-workers 0.8.x
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * こちらは TZ を固定していない (#322)。
 * サーバーのテストは workerd の中で動き、workerd の時刻は常に UTC で
 * 環境変数の TZ を見ない。加えて、サーバーが生成する日時テキストは
 * lib/dateFormat.ts・lib/emailTemplates.ts・lib/reminders.ts・routes/feeds.ts の
 * いずれも Intl に timeZone: "Asia/Tokyo" を明示しているため、
 * 実行環境の TZ では結果が変わらない（UTC・Asia/Tokyo・Pacific/Kiritimati で
 * 全件通ることを確認済み）。
 * 日時テキストをサーバーで新しく組み立てるときは、この前提を保つために
 * 必ず timeZone を明示すること。
 */
export default defineWorkersConfig(async () => {
  // apps/server/migrations の *.sql を読み、テスト用D1へ適用する
  const migrations = await readD1Migrations(path.join(here, "migrations"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      // 既定の 5 秒では CI が落ちる (#280)。実測で最も遅いテストが約3.1秒あり、
      // 遅いランナー（実測で約1.85倍）を引くと超える。
      // タイムアウトしても worker 側の処理は止まらないため、テスト用ストレージの
      // 後片付けが終わった後に D1 を触ってしまい、後片付け自体が中断して
      // テスト用DBが消える → 同じファイルの残りが総崩れ、という壊れ方をする。
      // hookTimeout は beforeAll のマイグレーション適用（60本超）が次に危ないので併せて上げる。
      testTimeout: 30_000,
      hookTimeout: 30_000,
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
              // 公式チャンネル署名 (#199) の検証用（テスト専用の固定鍵）
              NOSTR_SERVICE_KEY:
                "7f3b2a1c9e8d7c6b5a4938271605f4e3d2c1b0a99887766554433221100ffeed",
            },
          },
        },
      },
    },
  };
});
