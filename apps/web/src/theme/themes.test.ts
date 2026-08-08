import { describe, it, expect } from "vitest";
import { THEMES } from "./themes.js";

/**
 * テーマトークン (#315)。
 *
 * 年表は「主催・運営 = primary / 参加 = secondary」で塗り分けるが、
 * 淡い面の上に小さい文字で secondary を置く箇所（日付など）がある。
 * ライトテーマは素の secondary だと白地でコントラストが足りないため、
 * 暗い派生値を各テーマで明示している。自動導出に戻ると読めなくなるので、
 * 明示されていること自体を固定する。
 */

/** 相対輝度（WCAG 2.x） */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("テーマトークン", () => {
  it("すべてのテーマで secondary.dark が明示されている", () => {
    for (const [key, def] of Object.entries(THEMES)) {
      const dark = def.theme.palette.secondary.dark;
      expect(dark, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(dark, key).not.toBe(def.theme.palette.secondary.main);
    }
  });

  it("ライトテーマでは面の上に置いても本文並みのコントラストが出る", () => {
    for (const [key, def] of Object.entries(THEMES)) {
      if (def.theme.palette.mode !== "light") continue;
      const surface = def.theme.palette.background.paper;
      expect(
        contrast(def.theme.palette.secondary.dark, surface),
        `${key} secondary.dark`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(def.theme.palette.primary.dark, surface),
        `${key} primary.dark`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
