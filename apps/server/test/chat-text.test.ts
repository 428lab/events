import { describe, it, expect } from "vitest";
import { containsUrl, detectImageUrl, splitByUrls } from "@eventer/shared";

/** チャットのURL検出 (#241) はリンク化＝セキュリティ境界なので回帰テストを置く */
describe("チャット本文のURL検出 (#241)", () => {
  const urlsOf = (text: string) =>
    splitByUrls(text)
      .filter((t) => t.type === "url")
      .map((t) => t.value);

  it("http(s) のみリンク化し、他スキーム・迂回表記は絶対にマッチしない", () => {
    expect(urlsOf("https://example.com/a")).toEqual(["https://example.com/a"]);
    expect(urlsOf("HTTPS://EXAMPLE.COM/A")).toEqual(["HTTPS://EXAMPLE.COM/A"]);
    for (const bad of [
      "javascript:alert(1)",
      "jAvAsCrIpT:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "ｈｔｔｐｓ://example.com", // 全角
      "ht\u200btps://example.com", // ゼロ幅
      "https\u200b://example.com",
    ]) {
      expect(urlsOf(bad)).toEqual([]);
      expect(containsUrl(bad)).toBe(false);
    }
  });

  it("日本語直後・句読点・括弧の終端を正しく扱う", () => {
    expect(urlsOf("これ見てhttps://example.com/pathに続く")).toEqual([
      "https://example.com/path",
    ]);
    expect(urlsOf("(https://example.com/a)")).toEqual(["https://example.com/a"]);
    // Wikipedia 型の括弧入りURLは保持
    expect(urlsOf("https://example.com/Example_(foo)")).toEqual([
      "https://example.com/Example_(foo)",
    ]);
    expect(urlsOf("https://example.com/a.")).toEqual(["https://example.com/a"]);
  });

  it("ホストが空になる退化URLはテキスト扱い", () => {
    expect(urlsOf("https://.")).toEqual([]);
    expect(urlsOf("https://")).toEqual([]);
  });

  it("トークンを結合すると原文に戻る", () => {
    const text = "前 https://example.com/a) 後 https://example.com/b、末尾";
    expect(splitByUrls(text).map((t) => t.value).join("")).toBe(text);
  });

  it("画像URL判定: 対象拡張子のみ・SVGや偽装は除外", () => {
    expect(detectImageUrl("https://example.com/a.png")).toBe(true);
    expect(detectImageUrl("https://example.com/a.JPG?x=1")).toBe(true);
    expect(detectImageUrl("https://example.com/a.webp")).toBe(true);
    expect(detectImageUrl("https://example.com/a.svg")).toBe(false);
    expect(detectImageUrl("https://example.com/a.png.html")).toBe(false);
    expect(detectImageUrl("https://example.com/a?f=.png")).toBe(false);
    expect(detectImageUrl("javascript:x.png")).toBe(false);
  });
});
