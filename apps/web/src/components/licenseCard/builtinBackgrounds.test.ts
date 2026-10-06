import { describe, expect, it } from "vitest";
import { BUILTIN_BACKGROUNDS, builtinBackgroundMarkup, calmFactor, CALM_ZONES, mixColor } from "./builtinBackgrounds.js";

/** 名札のビルトイン背景のカタログの見張り。絵の良し悪しは card-backgrounds-check.html で目で見る */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("BUILTIN_BACKGROUNDS", () => {
  it("has 8-10 backgrounds with unique keys, each with 3-5 palettes", () => {
    expect(BUILTIN_BACKGROUNDS.length).toBeGreaterThanOrEqual(8);
    expect(BUILTIN_BACKGROUNDS.length).toBeLessThanOrEqual(10);
    expect(new Set(BUILTIN_BACKGROUNDS.map(b => b.key)).size).toBe(BUILTIN_BACKGROUNDS.length);
    for (const bg of BUILTIN_BACKGROUNDS) {
      expect(bg.palettes.length).toBeGreaterThanOrEqual(3);
      expect(bg.palettes.length).toBeLessThanOrEqual(5);
      expect(new Set(bg.palettes.map(p => p.key)).size).toBe(bg.palettes.length);
    }
  });
  it("gives every palette readable text colours on its base and on its accent band (WCAG AA)", () => {
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const where = `${bg.key}/${p.key}`;
      expect(contrast(p.ink, p.base), where).toBeGreaterThanOrEqual(7);
      expect(contrast(p.inkSub, p.base), where).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, p.base), where).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onAccent, p.accent), where).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("stays small and self-contained (no external references)", () => {
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const svg = builtinBackgroundMarkup(bg.key, p.key);
      expect(svg.length, `${bg.key}/${p.key}`).toBeLessThan(40 * 1024);
      expect(svg.replace(` xmlns="http://www.w3.org/2000/svg"`, "")).not.toMatch(/href|https?:|<image|<script/);
    }
  });
  it("draws the same picture every time", () => {
    for (const bg of BUILTIN_BACKGROUNDS)
      expect(builtinBackgroundMarkup(bg.key, bg.palettes[0]!.key)).toBe(builtinBackgroundMarkup(bg.key, bg.palettes[0]!.key));
  });
});

describe("calmFactor / mixColor", () => {
  it("is 0 inside the text zones and 1 far away from them", () => {
    for (const z of CALM_ZONES) expect(calmFactor((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, 100)).toBe(0);
    expect(calmFactor(1074, 650, 100)).toBe(1);
  });
  it("mixes two colours linearly", () => {
    expect(mixColor("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixColor("#102030", "#405060", 0)).toBe("#102030");
  });
});
