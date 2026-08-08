import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * web のテスト設定。サーバー側 (apps/server/vitest.config.ts) と同じく
 * vitest を使う。こちらはブラウザ向けなので jsdom + Testing Library で
 * 「DOM に何が出るか」を確かめる。
 *
 * 主目的は「人に見せる画面に出てはいけないもの」の退行防止 (#215):
 * 投影用画面・登壇者サイドパネルに参加UI・スタッフ操作・匿名投稿者の実名が
 * 出ないことを、実際に描画して確認する。
 */
export default defineConfig({
  plugins: [react()],
  // 本番ビルドで vite.config.ts が埋め込む定数。
  // テストでも参照する画面（VersionFooter など）があるのでダミーを入れる
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
