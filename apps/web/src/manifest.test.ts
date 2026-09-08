import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * ホーム画面に追加してアプリのように使う (#490)。
 *
 * manifest とアイコンの実体が食い違っても**画面上は何も起きない**
 * （ホーム画面のアイコンが既定の見た目になるだけ）ので、気づけるように固定する。
 * 配信されるかどうかの検査は apps/server 側（test/web-manifest.test.ts）。
 */
// vitest の root は apps/web（import.meta.url は vite-node 下で file: とは限らない）
const appDir = process.cwd();
const publicDir = path.join(appDir, "public");
const indexHtml = readFileSync(path.join(appDir, "index.html"), "utf-8");
const manifest = JSON.parse(
  readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf-8"),
) as {
  name: string;
  short_name: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string }[];
};

describe("web app manifest (#490)", () => {
  it("参照しているアイコンの実体が public/ にある", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("/"), icon.src).toBe(true);
      expect(existsSync(path.join(publicDir, icon.src.slice(1))), icon.src).toBe(
        true,
      );
    }
  });

  it("ホーム画面に必要な 512px のアイコンがある", () => {
    // Android は 512x512 が無いとホーム画面追加の候補から外すことがある
    expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true);
  });

  it("index.html が manifest を参照している", () => {
    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain("/manifest.webmanifest");
  });

  it("iOS 向けの指定も index.html にある（iOS は manifest の display を見ない機種が残る）", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title"');
  });

  it("テーマ色が manifest と index.html で食い違わない", () => {
    // 片方だけ直すと、起動スプラッシュとブラウザUIで色がずれる
    expect(indexHtml).toContain(
      `<meta name="theme-color" content="${manifest.theme_color}" />`,
    );
  });

  it("配色は DESIGN.md の background（夜祭の空）に合わせる", () => {
    expect(manifest.theme_color).toBe("#0E1426");
    expect(manifest.background_color).toBe("#0E1426");
  });
});
