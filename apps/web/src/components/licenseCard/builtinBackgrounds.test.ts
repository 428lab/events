import { describe, expect, it } from "vitest";
import {
  BUILTIN_BACKGROUNDS, builtinBackgroundMarkup, builtinBackgroundNodes, mixColor, strengthAt, STRENGTH_MIN, type BgNode,
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
    // 図形ごとの実際の塗り（親の fill を引き継ぎ、無指定は SVG の既定の黒）。クリップの中はインクにならない
    const fills = (nodes: BgNode[], inherited: string | undefined, out: string[]) => {
      for (const n of nodes) {
        if (n.tag === "clipPath") continue;
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
      expect(svg, where).not.toMatch(/Gradient|<mask|<filter|opacity/);
      for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) expect(Number(m[1]), where).toBeLessThanOrEqual(2.5);
    }
  });
  it("keeps every text colour readable on every line of the pattern (WCAG 4.5:1 against each stroke colour)", () => {
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const svg = builtinBackgroundMarkup(bg.key, p.key);
      for (const m of new Set([...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map(x => x[1]!)))
        for (const text of [p.ink, p.inkSub, p.accent])
          expect(contrast(text, m), `${bg.key}/${p.key} ${text} on stroke ${m}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("covers the whole card: the pattern reaches every quarter, including the name area", () => {
    // 描いた座標（M/L/H の点・circle の中心・transform の位置）を四分割で数える。pattern 敷きは全面扱い
    for (const bg of BUILTIN_BACKGROUNDS) {
      const svg = builtinBackgroundMarkup(bg.key, bg.palettes[0]!.key);
      if (/<rect[^>]*fill="url\(#/.test(svg)) continue;
      const hit = new Set<string>();
      const mark = (x: number, y: number) => { if (x >= 0 && x <= 1074 && y >= 0 && y <= 650) hit.add(`${x < 537 ? 0 : 1}${y < 325 ? 0 : 1}`); };
      for (const m of svg.matchAll(/[ML](-?[\d.]+)[ ,](-?[\d.]+)/g)) mark(Number(m[1]), Number(m[2]));
      for (const m of svg.matchAll(/translate\((-?[\d.]+) (-?[\d.]+)\)/g)) mark(Number(m[1]), Number(m[2]));
      for (const m of svg.matchAll(/cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)) mark(Number(m[1]), Number(m[2]));
      // 名前の箱（56,200〜786,332）の中にも線が通る
      let inName = false;
      for (const m of svg.matchAll(/[ML](-?[\d.]+)[ ,](-?[\d.]+)|translate\((-?[\d.]+) (-?[\d.]+)\)/g)) {
        const x = Number(m[1] ?? m[3]), y = Number(m[2] ?? m[4]);
        if (x > 56 && x < 786 && y > 200 && y < 332) inName = true;
      }
      expect(hit.size, bg.key).toBe(4);
      expect(inName, bg.key).toBe(true);
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

describe("strengthAt / mixColor", () => {
  it("lightens the pattern gently toward the text side without cutting a hole", () => {
    expect(strengthAt(0, 0)).toBeCloseTo(STRENGTH_MIN);
    expect(strengthAt(1074, 650)).toBe(1);
    // 名前の箱の中でも模様は消えない（0 にならない）
    for (const [x, y] of [[56, 200], [420, 266], [786, 332]]) expect(strengthAt(x!, y!)).toBeGreaterThanOrEqual(STRENGTH_MIN);
  });
  it("mixes two colours linearly", () => {
    expect(mixColor("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixColor("#102030", "#405060", 0)).toBe("#102030");
  });
});
