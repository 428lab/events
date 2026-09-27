import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dynamic cut-in lettering asset", () => {
  it("self-hosts a complete licensed font instead of sample glyph outlines", () => {
    const asset = "public/fonts/YujiSyuku-Regular.woff2";
    const license = readFileSync("public/fonts/OFL-Yuji-Syuku.txt", "utf8");
    const css = readFileSync("src/components/LiveCutin.css", "utf8");
    expect(statSync(asset).size).toBeGreaterThan(100000);
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(css).toContain("url('/fonts/YujiSyuku-Regular.woff2')");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
