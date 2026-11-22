import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * PDF の取り込み（docs/slide-editor.md「PDF から取り込む」）が使う pdf.js の付属ファイル。
 * CMap（日本語の PDF の文字を取り出すのに要る）・標準フォント・wasm（JPEG2000 など）を
 * `/pdfjs/<版>/` に置く。版をパスに入れるので、pdf.js を上げたときに古いものと混ざらない。
 * 取り込みの画面で必要になったときだけ読まれる（ほかの画面は取りに行かない）。
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  const dirs = ["cmaps", "standard_fonts", "wasm"];
  const prefix = `/pdfjs/${version}/`;
  const files = dirs.flatMap((dir) =>
    readdirSync(path.join(root, dir))
      .filter((name) => statSync(path.join(root, dir, name)).isFile() && !/^LICENSE/.test(name))
      .map((name) => `${dir}/${name}`),
  );
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        if (!url.startsWith(prefix)) return next();
        const rel = url.slice(prefix.length);
        if (!files.includes(rel)) return next();
        res.setHeader("Content-Type", rel.endsWith(".wasm") ? "application/wasm" : rel.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(path.join(root, rel)));
      });
    },
    generateBundle() {
      for (const rel of files) {
        this.emitFile({ type: "asset", fileName: `pdfjs/${version}/${rel}`, source: readFileSync(path.join(root, rel)) });
      }
    },
  };
}

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
    pdfjsAssets(),
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
