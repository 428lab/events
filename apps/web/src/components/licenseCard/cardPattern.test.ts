import { describe, expect, it } from "vitest";
import { cardPatternMarkup, cardPatternNodes, resolveCardPattern } from "./cardPattern.js";
import { builtinBackgroundNodes, inkOnWhite, mixColor, NAME_CARD_TEXT_COLORS, TEXT_ON_PATTERN_CONTRAST, type BgNode } from "./builtinBackgrounds.js";
import { CARD_THEMES } from "./cardTheme.js";
import { CARD_PATTERN_CATALOGUE, type CardPatternKey, type CardPatternTheme } from "@eventer/shared";
import { firstLoop } from "./cardPattern.js";
import { ARC_CIRCLES, FLOW_BAND, FLOW_LINES, ROSETTE_CURVES, ROSETTE_WAVES, TOPO_CONTOURS } from "./patternData.js";

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** Paper "none" is the white name-card render; the guilloché and license line checks below run on it. */
const white = { paper: "none" as const };
const licenseChoices = () => Object.entries(CARD_PATTERN_CATALOGUE).filter(([k]) => k.startsWith("license-"))
  .flatMap(([key, palettes]) => (palettes as readonly CardPatternTheme[]).map(palette => ({ key: key as CardPatternKey, palette })));

describe("resolveCardPattern (D-CARD-BG)", () => {
  const participant = { type: "participant" as const, fallback: { key: "rosette" as const, palette: "indigo" as const }, strength: 0.7, paper: "card" as const };
  it("uses the owner's saved license-card look in participant mode, carrying strength and paper", () => {
    expect(resolveCardPattern(participant, "topo-teal")).toEqual({ key: "license-topo", palette: "teal", strength: 0.7, paper: "card" });
    expect(resolveCardPattern({ ...participant, paper: "none" }, "arcs-rose")).toEqual({ key: "license-arcs", palette: "rose", strength: 0.7, paper: "none" });
  });
  it("falls back to the design's choice for owners without a look, never the printing device's local default", () => {
    localStorage.setItem("eventer:cardBg", "flow");
    try {
      expect(resolveCardPattern(participant, null)).toEqual({ key: "rosette", palette: "indigo", strength: 0.7, paper: "card" });
      expect(resolveCardPattern(participant, "nonsense")).toEqual({ key: "rosette", palette: "indigo", strength: 0.7, paper: "card" });
    } finally { localStorage.removeItem("eventer:cardBg"); }
  });
  it("gives every card the same background in builtin mode, and nothing without a pattern", () => {
    const builtin = { type: "builtin" as const, key: "mesh" as const, palette: "rose" as const, strength: 1, paper: "card" as const };
    expect(resolveCardPattern(builtin, "topo-teal")).toEqual({ key: "mesh", palette: "rose", strength: 1, paper: "card" });
    expect(resolveCardPattern(builtin, null)).toEqual({ key: "mesh", palette: "rose", strength: 1, paper: "card" });
    expect(resolveCardPattern(undefined, "topo-teal")).toBeNull();
  });
});

describe("cardPatternNodes, paper \"none\" (white)", () => {
  it("draws license-card patterns on white without the paper gradient, lightening every line with strength", () => {
    const full = cardPatternMarkup({ key: "license-topo", palette: "teal", strength: 1, ...white });
    const half = cardPatternMarkup({ key: "license-topo", palette: "teal", strength: 0.5, ...white });
    expect(full).toContain('fill="#FFFFFF"');
    expect(full).not.toMatch(/Gradient|<filter|url\(|opacity/);
    const strokes = (svg: string) => [...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]!);
    expect(strokes(half)).toHaveLength(strokes(full).length);
    strokes(half).forEach((c, i) => expect(luminance(c)).toBeGreaterThan(luminance(strokes(full)[i]!)));
  });
  it("lightens guilloché lines with strength (less ink)", () => {
    const darkness = (svg: string) => [...svg.matchAll(/stroke="#([0-9A-Fa-f]{6})"/g)]
      .reduce((sum, m) => sum + (765 - [0, 2, 4].reduce((a, i) => a + parseInt(m[1]!.slice(i, i + 2), 16), 0)), 0);
    const full = cardPatternMarkup({ key: "rosette", palette: "indigo", strength: 1, ...white });
    const half = cardPatternMarkup({ key: "rosette", palette: "indigo", strength: 0.5, ...white });
    expect(darkness(half)).toBeLessThan(darkness(full) * 0.6);
  });
  it("generates a guilloché background once per (key, palette, strength) and reuses it", () => {
    const a = cardPatternNodes({ key: "engine", palette: "amber", strength: 0.8, ...white });
    expect(cardPatternNodes({ key: "engine", palette: "amber", strength: 0.8, ...white })).toBe(a);
    expect(builtinBackgroundNodes("engine", "amber", "other-id", 0.8)).toBe(a);
    expect(cardPatternNodes({ key: "engine", palette: "amber", strength: 0.8, paper: "card" })).not.toBe(a);
    expect(cardPatternNodes({ key: "engine", palette: "amber", strength: 0.6, ...white })).not.toBe(a);
  });
  it("uses no ids, so many cards on one sheet cannot collide", () => {
    for (const key of ["rosette", "mesh", "license-rosette", "license-flow"] as const)
      expect(cardPatternMarkup({ key, palette: "indigo", strength: 1, ...white })).not.toMatch(/\sid="/);
  });

  it("keeps the default template's teal and rose text readable on every guilloché line too", () => {
    for (const [key, palettes] of Object.entries(CARD_PATTERN_CATALOGUE)) if (!key.startsWith("license-")) for (const palette of palettes as readonly string[]) {
      const svg = cardPatternMarkup({ key: key as CardPatternKey, palette: palette as CardPatternTheme, strength: 1, ...white });
      for (const stroke of new Set([...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]!)))
        for (const text of NAME_CARD_TEXT_COLORS) expect(contrast(text, stroke), `${key}/${palette} ${text} on ${stroke}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps the default template's text readable on every license-pattern line (WCAG 4.5:1), and fills only the white base and the flow band", () => {
    for (const { key, palette } of licenseChoices()) {
      const svg = cardPatternMarkup({ key, palette, strength: 1, ...white });
      for (const stroke of new Set([...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]!)))
        for (const text of NAME_CARD_TEXT_COLORS)
          expect(contrast(text, stroke), `${key}/${palette} ${text} on ${stroke}`).toBeGreaterThanOrEqual(Math.min(4.5, TEXT_ON_PATTERN_CONTRAST));
      const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]!);
      expect(fills.length, `${key}/${palette}`).toBeLessThanOrEqual(key === "license-flow" ? 2 : 1);
      for (const fill of fills.slice(1)) expect(luminance(fill), `${key}/${palette} flow band`).toBeGreaterThan(0.85);
    }
  });
  it("keeps license-pattern ink light (estimated line coverage <= 8%)", () => {
    for (const { key, palette } of licenseChoices()) {
      let ink = 0;
      for (const n of cardPatternNodes({ key, palette, strength: 1, ...white }) as BgNode[]) {
        const darkness = 1 - luminance(String(n.attrs.stroke ?? "#FFFFFF")), width = Number(n.attrs["stroke-width"] ?? 0);
        if (n.tag === "circle") ink += 2 * Math.PI * Number(n.attrs.r) * width * darkness;
        if (n.tag !== "path" || !n.attrs.stroke) continue;
        const pts = [...String(n.attrs.d).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
        for (let k = 1; k < pts.length; k++) ink += Math.hypot(pts[k]![0]! - pts[k - 1]![0]!, pts[k]![1]! - pts[k - 1]![1]!) * width * darkness;
      }
      expect(ink / (1074 * 650), `${key}/${palette}`).toBeLessThanOrEqual(0.08);
    }
  });
  it("draws each repeated rosette loop once, keeping its shape", () => {
    for (const p of ROSETTE_CURVES) {
      const once = firstLoop(p.d);
      expect(once.length).toBeLessThan(p.d.length / 10);
      expect(p.d.startsWith(once)).toBe(true);
      const pts = once.split(" ");
      expect(pts.at(-1)!.slice(1)).toBe(pts[0]!.slice(1));
    }
    expect(firstLoop("M0,0 L5,5 L9,0")).toBe("M0,0 L5,5 L9,0");
  });
});

describe("cardPatternNodes, paper \"card\" (the license-card tint)", () => {
  const paperRect = (nodes: BgNode[]) => nodes.find(n => n.tag === "rect" && String(n.attrs.fill).startsWith("url(#"));
  const stops = (nodes: BgNode[], id: string) => nodes.find(n => n.tag === "defs")!.children!
    .find(n => n.attrs.id === id)!.children!.map(n => n.attrs);
  it("draws the license card exactly: theme paper gradient, the pattern's own colours and opacities, then the sheen", () => {
    for (const { key, palette } of licenseChoices()) {
      const theme = CARD_THEMES.find(t => t.key === palette)!;
      const nodes = cardPatternNodes({ key, palette, strength: 1, paper: "card" }, "c1");
      expect(stops(nodes, "c1-paper").map(s => s["stop-color"])).toEqual(theme.paper.map(c => c.toLowerCase()));
      expect(stops(nodes, "c1-sheen").map(s => [s.offset, s["stop-color"], s["stop-opacity"]]))
        .toEqual([[0.3, "#FFFFFF", 0], [0.46, "#B7C4FF", 0.2], [0.54, "#9BE8DE", 0.16], [0.7, "#FFFFFF", 0]]);
      expect(nodes[1]).toBe(paperRect(nodes));
      expect(nodes.at(-1)!.attrs).toMatchObject({ fill: "url(#c1-sheen)", opacity: 0.16 });
      const lines = nodes.slice(2, -1);
      const variant = key.slice(8);
      const expected = variant === "rosette" ? [...ROSETTE_WAVES, ...ROSETTE_CURVES].map(p => p.opacity)
        : variant === "topo" ? TOPO_CONTOURS.map(p => p.opacity) : variant === "arcs" ? ARC_CIRCLES.map(c => c.opacity)
        : [...FLOW_LINES.map(p => p.opacity), FLOW_BAND.opacity];
      expect(lines.map(n => n.attrs.opacity), `${key}/${palette}`).toEqual(expected);
      // No on-white flattening: strokes are the theme accents themselves.
      for (const n of lines) if (n.attrs.stroke) expect([theme.accentA, theme.accentB, theme.accentBLight]).toContain(n.attrs.stroke);
    }
  });
  it("keeps the rosette curves' shape but draws each repeated loop once (1x screens would stack them)", () => {
    const nodes = cardPatternNodes({ key: "license-rosette", palette: "indigo", strength: 1, paper: "card" });
    const curves = nodes.slice(2 + ROSETTE_WAVES.length, -1);
    expect(curves.map(n => n.attrs.d)).toEqual(ROSETTE_CURVES.map(p => firstLoop(p.d)));
  });
  it("puts the theme paper under guilloché backgrounds too, with opaque lines and no white base", () => {
    for (const [key, palettes] of Object.entries(CARD_PATTERN_CATALOGUE)) if (!key.startsWith("license-")) for (const palette of palettes as readonly CardPatternTheme[]) {
      const nodes = cardPatternNodes({ key: key as CardPatternKey, palette, strength: 1, paper: "card" }, "g");
      expect(stops(nodes, "g-paper").map(s => s["stop-color"])).toEqual(CARD_THEMES.find(t => t.key === palette)!.paper.map(c => c.toLowerCase()));
      expect(nodes.some(n => n.tag === "rect" && n.attrs.fill === "#FFFFFF"), `${key}/${palette}`).toBe(false);
      expect(JSON.stringify(nodes.slice(2, -1)), `${key}/${palette}`).not.toMatch(/opacity/);
    }
  });
  it("scales the lines and the paper's departure from white with strength", () => {
    const lum = (nodes: BgNode[]) => stops(nodes, "s-paper").map(s => luminance(String(s["stop-color"])));
    for (const key of ["license-topo", "mesh"] as const) {
      const full = cardPatternNodes({ key, palette: "teal", strength: 1, paper: "card" }, "s");
      const light = cardPatternNodes({ key, palette: "teal", strength: 0.4, paper: "card" }, "s");
      lum(light).forEach((l, i) => expect(l).toBeGreaterThan(lum(full)[i]!));
      // At 0.4 the paper keeps only 40% of its tint: close to white.
      for (const s of stops(light, "s-paper")) expect(luminance(String(s["stop-color"]))).toBeGreaterThan(0.85);
      expect(Number(light.at(-1)!.attrs.opacity)).toBeLessThan(Number(full.at(-1)!.attrs.opacity));
      const strokes = (nodes: BgNode[]) => JSON.stringify(nodes).match(/"stroke":"#[0-9a-fA-F]{6}"/g)!.map(m => m.slice(10, 17));
      if (key === "mesh") strokes(light).forEach((c, i) => expect(luminance(c)).toBeGreaterThan(luminance(strokes(full)[i]!)));
      else light.slice(2, -1).forEach((n, i) => expect(Number(n.attrs.opacity)).toBeCloseTo(0.4 * Number(full[i + 2]!.attrs.opacity), 4));
    }
  });
  it("gives every card on a sheet its own gradient ids", () => {
    const a = cardPatternMarkup({ key: "license-flow", palette: "rose", strength: 1, paper: "card" });
    expect(a).toContain('id="card-bg-paper"');
    expect(JSON.stringify(cardPatternNodes({ key: "license-flow", palette: "rose", strength: 1, paper: "card" }, "other"))).not.toContain("card-bg-");
  });
  it("keeps the default template's text readable (WCAG 4.5:1) on every paper and every line laid on its darkest stop", () => {
    // The darkest paper stop with each line colour composited at full coverage; the sheen only lightens. Crossings and
    // anti-aliasing are checked on rendered pixels in the browser measurement (minimum 4.81 at strength 1).
    for (const [key, palettes] of Object.entries(CARD_PATTERN_CATALOGUE)) for (const palette of palettes as readonly CardPatternTheme[]) {
      const nodes = cardPatternNodes({ key: key as CardPatternKey, palette, strength: 1, paper: "card" }, "w");
      const paper = stops(nodes, "w-paper").map(s => String(s["stop-color"])).sort((x, y) => luminance(x) - luminance(y))[0]!;
      const worst: string[] = [paper];
      const walk = (list: BgNode[]) => { for (const n of list) {
        const color = String(n.attrs.stroke ?? n.attrs.fill ?? "");
        if (/^#[0-9a-fA-F]{6}$/.test(color)) {
          const opacity = Number(n.attrs.opacity ?? 1);
          worst.push(opacity < 1 ? mixColor(paper, color, opacity) : color);
        }
        if (n.children) walk(n.children);
      } };
      walk(nodes.slice(2, -1));
      for (const under of worst) for (const text of NAME_CARD_TEXT_COLORS)
        expect(contrast(text, under), `${key}/${palette} ${text} on ${under}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("draws guilloché lines on paper as the white render's ink laid on the paper", () => {
    expect(inkOnWhite("#FFFFFF")).toEqual({ color: "#FFFFFF", alpha: 0 });
    const { color, alpha } = inkOnWhite("#C0C8F0");
    expect(mixColor("#FFFFFF", color, alpha)).toBe("#c0c8f0");
  });
});
