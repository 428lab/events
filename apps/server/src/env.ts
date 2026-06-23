// 環境設定は Cloudflare Worker のバインディング由来（runtime.ts）。
// 旧 dotenv ベースの実装からの後方互換のため、ここで再エクスポートする。
export { env } from "./runtime.js";
