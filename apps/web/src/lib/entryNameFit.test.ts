import { describe, expect, it } from "vitest";
import { entryNameFontSize, entryNameWidthEm } from "./entryNameFit.js";

/** 発表画面・表彰式で大きく出すエントリー名の文字サイズ (#9) */
describe("entryNameFit", () => {
  it("和文は1文字1em、英数字は0.6emで幅を見積もる（4%の余裕込み）", () => {
    expect(entryNameWidthEm("チーム・いぬ")).toBeCloseTo(6 * 1.04);
    expect(entryNameWidthEm("ABCDE")).toBeCloseTo(3 * 1.04);
    expect(entryNameWidthEm("")).toBeCloseTo(1.04);
  });

  it("見出しの幅（100cqi）を名前の幅で割り、最小・最大の間に収める", () => {
    expect(entryNameFontSize("チーム・いぬ", { minPx: 24, maxPx: 48 })).toBe("clamp(24px, calc(100cqi / 6.24), 48px)");
    expect(entryNameFontSize("チーム・とり", { minPx: 24, maxPx: 48, reservePx: 62 })).toBe(
      "clamp(24px, calc((100cqi - 62px) / 6.24), 48px)",
    );
  });

  it("長い名前ほど小さくなる（同じ幅に入れるため）", () => {
    const divisor = (name: string) => Number(/\/ ([\d.]+)\)/.exec(entryNameFontSize(name, { minPx: 24, maxPx: 48 }))![1]);
    expect(divisor("チーム・いぬ")).toBeLessThan(divisor("とても長いチーム名をつけてみたハッカソン部"));
  });
});
