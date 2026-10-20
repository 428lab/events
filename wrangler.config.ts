import { defineWranglerConfig } from "wrangler/experimental-config";

/**
 * cf がビルド（内部で wrangler build）に渡す設定。cf の cloudflare.config.ts には
 * assets のディレクトリを書けないので、ここに置く（staging と本番で同じ）。
 * 参照: https://developers.cloudflare.com/cf/wrangler/migrate/ の "Build settings"
 */
export default defineWranglerConfig({
  assetsDirectory: "apps/web/dist",
});
