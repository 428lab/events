import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * テストのタイムゾーンを日本時間に固定する (#322)。
 *
 * 画面に出す日時（apps/web/src/lib/format.ts）は、利用者の端末の時刻で
 * 見せたいので Intl に timeZone を渡していない＝実行環境の TZ に従う。
 * そのためテストが実行環境の TZ に左右され、日本時間のローカルでは通るのに
 * UTC の CI では落ちる、という壊れ方をしていた。
 * 個々のテストで文字列を避けて回るのではなく、ここで前提を固定する。
 * ここで代入しておけば、テストを走らせるワーカーにも引き継がれる。
 */
process.env.TZ = "Asia/Tokyo";

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
