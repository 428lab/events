import { describe, expect, it } from "vitest";
import {
  BUILTIN_BACKGROUNDS, builtinBackgroundMarkup, builtinBackgroundNodes, calmFactor, CALM_ZONES, mixColor, type BgNode,
} from "./builtinBackgrounds.js";

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
  it("has 8-10 backgrounds with unique keys, each with 3-4 palettes", () => {
    expect(BUILTIN_BACKGROUNDS.length).toBeGreaterThanOrEqual(8);
    expect(BUILTIN_BACKGROUNDS.length).toBeLessThanOrEqual(10);
    expect(new Set(BUILTIN_BACKGROUNDS.map(b => b.key)).size).toBe(BUILTIN_BACKGROUNDS.length);
    for (const bg of BUILTIN_BACKGROUNDS) {
      expect(bg.palettes.length).toBeGreaterThanOrEqual(3);
      expect(bg.palettes.length).toBeLessThanOrEqual(4);
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
  it("prints on white: every base is white or a faint tint (lightness >= 97%)", () => {
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(p.base.slice(i, i + 2), 16) / 255);
      const lightness = (Math.max(r!, g!, b!) + Math.min(r!, g!, b!)) / 2;
      expect(lightness, `${bg.key}/${p.key}`).toBeGreaterThanOrEqual(0.97);
      expect(luminance(p.base), `${bg.key}/${p.key}`).toBeGreaterThanOrEqual(0.93);
    }
  });
  it("saves ink: only the base colour is filled, the pattern is hairlines (pixel coverage is measured by the capture script)", () => {
    const SHAPES = new Set(["rect", "circle", "ellipse", "polygon", "path"]);
    // 図形ごとの実際の塗り（親の fill を引き継ぎ、無指定は SVG の既定の黒）。マスクとクリップの中はインクにならない
    const fills = (nodes: BgNode[], inherited: string | undefined, out: string[]) => {
      for (const n of nodes) {
        if (n.tag === "mask" || n.tag === "clipPath" || n.tag === "filter") continue;
        const fill = typeof n.attrs.fill === "string" ? n.attrs.fill : inherited;
        if (SHAPES.has(n.tag)) out.push(fill ?? "#000000");
        if (n.children) fills(n.children, fill, out);
      }
      return out;
    };
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const where = `${bg.key}/${p.key}`;
      for (const fill of fills(builtinBackgroundNodes(bg.key, p.key, "t"), undefined, []))
        expect(fill === "none" || fill === p.base || fill.startsWith("url(#t-"), `${where} fill ${fill}`).toBe(true);
      const svg = builtinBackgroundMarkup(bg.key, p.key);
      expect(svg, where).not.toMatch(/Gradient/);
      for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) expect(Number(m[1]), where).toBeLessThanOrEqual(2.5);
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
