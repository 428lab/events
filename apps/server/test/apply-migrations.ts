import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// 各テストファイルの実行前にマイグレーションを適用（適用済みは冪等にスキップ）
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
