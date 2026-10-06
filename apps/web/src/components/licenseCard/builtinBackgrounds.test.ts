import { describe, expect, it } from "vitest";
import {
  BUILTIN_BACKGROUNDS, builtinBackgroundMarkup, builtinBackgroundNodes, legibleStroke, mixColor, type BgNode,
} from "./builtinBackgrounds.js";
import { CARD_THEMES } from "./cardTheme.js";

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
  it("has 4-6 backgrounds with unique keys, each with 3-5 palettes", () => {
    expect(BUILTIN_BACKGROUNDS.length).toBeGreaterThanOrEqual(4);
    expect(BUILTIN_BACKGROUNDS.length).toBeLessThanOrEqual(6);
    expect(new Set(BUILTIN_BACKGROUNDS.map(b => b.key)).size).toBe(BUILTIN_BACKGROUNDS.length);
    for (const bg of BUILTIN_BACKGROUNDS) {
      expect(bg.palettes.length).toBeGreaterThanOrEqual(3);
      expect(bg.palettes.length).toBeLessThanOrEqual(5);
      expect(new Set(bg.palettes.map(p => p.key)).size).toBe(bg.palettes.length);
    }
  });
  it("draws its lines in the license-card theme colours (CARD_THEMES accentA / accentB / accentBLight)", () => {
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const theme = CARD_THEMES.find(t => t.key === p.key);
      expect(theme, `${bg.key}/${p.key}`).toBeDefined();
      expect(p.colors).toEqual([theme!.accentA, theme!.accentB, theme!.accentBLight]);
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
  it("prints on white: every base is white", () => {
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) expect(p.base, `${bg.key}/${p.key}`).toBe("#FFFFFF");
  });
  it("saves ink: only the base colour is filled, the pattern is hairlines", () => {
    // 図形ごとの実際の塗り（親の fill を引き継ぎ、無指定は SVG の既定の黒）
    const fills = (nodes: BgNode[], inherited: string | undefined, out: string[]) => {
      for (const n of nodes) {
        const fill = typeof n.attrs.fill === "string" ? n.attrs.fill : inherited;
        if (n.tag !== "g") out.push(fill ?? "#000000");
        if (n.children) fills(n.children, fill, out);
      }
      return out;
    };
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const where = `${bg.key}/${p.key}`;
      for (const fill of fills(builtinBackgroundNodes(bg.key, p.key, "t"), undefined, []))
        expect(fill === "none" || fill === p.base, `${where} fill ${fill}`).toBe(true);
      const svg = builtinBackgroundMarkup(bg.key, p.key);
      expect(svg, where).not.toMatch(/Gradient|<mask|<filter|<pattern|opacity/);
      // 地紋の線は細線（ライセンスカードの地紋と同じ 0.3〜1px 程度）
      for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) expect(Number(m[1]), where).toBeLessThanOrEqual(1);
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
  it("covers the whole card and keeps the ink light (estimated line coverage <= 10%)", () => {
    // 線の頂点が 18px 格子のどのマスに落ちるかで、全面に敷いているかを見る。名前の箱（56,200〜786,332）にも線が通る。
    // インク量は「線の長さ × 太さ × 線の色の濃さ」をカードの面積で割った見積もり（重なりも足すので実測より多め）。
    // 実際の画素での計測は /tmp の計測スクリプト（ブラウザで描いた画像）で行う
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const where = `${bg.key}/${p.key}`;
      const cells = new Set<number>();
      let ink = 0, inName = false;
      const walk = (nodes: BgNode[]) => {
        for (const n of nodes) {
          if (n.tag === "path") {
            const width = Number(n.attrs["stroke-width"]), darkness = 1 - luminance(String(n.attrs.stroke));
            for (const run of String(n.attrs.d).split("M").filter(Boolean)) {
              const pts = run.trim().split(" ").map(t => t.split(",").map(Number) as [number, number]);
              for (let k = 0; k < pts.length; k++) {
                const [x, y] = pts[k]!;
                if (x >= 0 && x < 1074 && y >= 0 && y < 650) cells.add(Math.floor(y / 18) * 60 + Math.floor(x / 18));
                if (x > 56 && x < 786 && y > 200 && y < 332) inName = true;
                if (k) ink += Math.hypot(x - pts[k - 1]![0], y - pts[k - 1]![1]) * width * darkness;
              }
            }
          }
          if (n.children) walk(n.children);
        }
      };
      walk(builtinBackgroundNodes(bg.key, p.key, "t"));
      expect(inName, where).toBe(true);
      // 線の通るマスが全体の 9 割以上（どこかに寄せて穴を空けていない）
      expect(cells.size / (60 * 37), where).toBeGreaterThan(0.9);
      expect(ink / (1074 * 650), where).toBeLessThanOrEqual(0.1);
    }
  });
  it("is self-contained (no external references)", () => {
    for (const bg of BUILTIN_BACKGROUNDS) for (const p of bg.palettes) {
      const svg = builtinBackgroundMarkup(bg.key, p.key);
      expect(svg.replace(` xmlns="http://www.w3.org/2000/svg"`, "")).not.toMatch(/href|https?:|<image|<script/);
    }
  });
  it("draws the same picture every time", () => {
    for (const bg of BUILTIN_BACKGROUNDS)
      expect(builtinBackgroundMarkup(bg.key, bg.palettes[0]!.key)).toBe(builtinBackgroundMarkup(bg.key, bg.palettes[0]!.key));
  });
  it("generates the pattern from code: the module itself holds no long path literals", async () => {
    const source = (await import("./builtinBackgrounds.ts?raw")).default;
    expect(source.length).toBeLessThan(40 * 1024);
    expect(source).not.toMatch(/"M[\d\s.,LC-]{200,}/);
  });
});

describe("legibleStroke / mixColor", () => {
  it("lightens a stroke until every text colour reads on it, and leaves light strokes alone", () => {
    const p = BUILTIN_BACKGROUNDS[0]!.palettes[0]!;
    for (const text of [p.ink, p.inkSub, p.accent]) expect(contrast(text, legibleStroke(p, "#000000"))).toBeGreaterThanOrEqual(4.5);
    expect(legibleStroke(p, "#F0F0F0")).toBe("#F0F0F0");
  });
  it("mixes two colours linearly", () => {
    expect(mixColor("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mixColor("#102030", "#405060", 0)).toBe("#102030");
  });
});
