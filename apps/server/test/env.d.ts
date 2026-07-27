import type { D1Migration } from "@cloudflare/workers-types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: import("@cloudflare/workers-types").D1Database;
    BUCKET: import("@cloudflare/workers-types").R2Bucket;
    TEST_MIGRATIONS: D1Migration[];
    ENVIRONMENT: string;
    APP_BASE_URL: string;
    SESSION_SECRET: string;
    ADMIN_DISCORD_IDS: string;
  }
}
