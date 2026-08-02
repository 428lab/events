import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ビルド時刻（JST）から日付ベースのバージョンを生成。
// 同日複数リリースを区別できるよう時刻(HHmm)も付ける。
const jst = new Date(Date.now() + 9 * 3600 * 1000);
const p = (n: number) => String(n).padStart(2, "0");
const APP_VERSION = `${jst.getUTCFullYear()}.${p(jst.getUTCMonth() + 1)}.${p(
  jst.getUTCDate(),
)}-${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}`;

export default defineConfig({
  plugins: [
    react(),
    // デプロイ後の古いバンドル検知用 (#143)。ビルド成果物に version.json を含める
    {
      name: "emit-version-json",
      apply: "build" as const,
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ version: APP_VERSION }),
        });
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // react-draggable(react-rnd) のデバッグログが process.env を参照して
    // ブラウザで ReferenceError になるのを防ぐ
    "process.env.DRAGGABLE_DEBUG": "false",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { "process.env.DRAGGABLE_DEBUG": "false" },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4280,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
