import { describe, expect, it } from "vitest";
import { cardPatternMarkup, cardPatternNodes, resolveCardPattern } from "./cardPattern.js";
import { builtinBackgroundNodes, NAME_CARD_TEXT_COLORS, TEXT_ON_PATTERN_CONTRAST, type BgNode } from "./builtinBackgrounds.js";
import { CARD_PATTERN_CATALOGUE, type CardPatternKey, type CardPatternTheme } from "@eventer/shared";
import { firstLoop } from "./cardPattern.js";
import { ROSETTE_CURVES } from "./patternData.js";

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const licenseChoices = () => Object.entries(CARD_PATTERN_CATALOGUE).filter(([k]) => k.startsWith("license-"))
  .flatMap(([key, palettes]) => (palettes as readonly CardPatternTheme[]).map(palette => ({ key: key as CardPatternKey, palette })));

describe("resolveCardPattern (D-CARD-BG)", () => {
  const participant = { type: "participant" as const, fallback: { key: "rosette" as const, palette: "indigo" as const }, strength: 0.7 };
  it("uses the owner's saved license-card look in participant mode", () => {
    expect(resolveCardPattern(participant, "topo-teal")).toEqual({ key: "license-topo", palette: "teal", strength: 0.7 });
    expect(resolveCardPattern(participant, "arcs-rose")).toEqual({ key: "license-arcs", palette: "rose", strength: 0.7 });
  });
  it("falls back to the design's choice for owners without a look, never the printing device's local default", () => {
    localStorage.setItem("eventer:cardBg", "flow");
    try {
      expect(resolveCardPattern(participant, null)).toEqual({ key: "rosette", palette: "indigo", strength: 0.7 });
      expect(resolveCardPattern(participant, "nonsense")).toEqual({ key: "rosette", palette: "indigo", strength: 0.7 });
    } finally { localStorage.removeItem("eventer:cardBg"); }
  });
  it("gives every card the same background in builtin mode, and nothing without a pattern", () => {
    const builtin = { type: "builtin" as const, key: "mesh" as const, palette: "rose" as const, strength: 1 };
    expect(resolveCardPattern(builtin, "topo-teal")).toEqual({ key: "mesh", palette: "rose", strength: 1 });
    expect(resolveCardPattern(builtin, null)).toEqual({ key: "mesh", palette: "rose", strength: 1 });
    expect(resolveCardPattern(undefined, "topo-teal")).toBeNull();
  });
});

describe("cardPatternNodes", () => {
  it("draws license-card patterns on white without the paper gradient, lightening every line with strength", () => {
    const full = cardPatternMarkup({ key: "license-topo", palette: "teal", strength: 1 });
    const half = cardPatternMarkup({ key: "license-topo", palette: "teal", strength: 0.5 });
    expect(full).toContain('fill="#FFFFFF"');
    expect(full).not.toMatch(/Gradient|<filter|url\(|opacity/);
    const strokes = (svg: string) => [...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]!);
    expect(strokes(half)).toHaveLength(strokes(full).length);
    strokes(half).forEach((c, i) => expect(luminance(c)).toBeGreaterThan(luminance(strokes(full)[i]!)));
  });
  it("lightens guilloché lines with strength (less ink)", () => {
    const darkness = (svg: string) => [...svg.matchAll(/stroke="#([0-9A-Fa-f]{6})"/g)]
      .reduce((sum, m) => sum + (765 - [0, 2, 4].reduce((a, i) => a + parseInt(m[1]!.slice(i, i + 2), 16), 0)), 0);
    const full = cardPatternMarkup({ key: "rosette", palette: "indigo", strength: 1 });
    const half = cardPatternMarkup({ key: "rosette", palette: "indigo", strength: 0.5 });
    expect(darkness(half)).toBeLessThan(darkness(full) * 0.6);
  });
  it("generates a guilloché background once per (key, palette, strength) and reuses it", () => {
    const a = cardPatternNodes({ key: "engine", palette: "amber", strength: 0.8 });
    expect(cardPatternNodes({ key: "engine", palette: "amber", strength: 0.8 })).toBe(a);
    expect(builtinBackgroundNodes("engine", "amber", "other-id", 0.8)).toBe(a);
    expect(cardPatternNodes({ key: "engine", palette: "amber", strength: 0.6 })).not.toBe(a);
  });
  it("uses no ids, so many cards on one sheet cannot collide", () => {
    for (const key of ["rosette", "mesh", "license-rosette", "license-flow"] as const)
      expect(cardPatternMarkup({ key, palette: "indigo", strength: 1 })).not.toMatch(/\sid="/);
  });

  it("keeps the default template's teal and rose text readable on every guilloché line too", () => {
    for (const [key, palettes] of Object.entries(CARD_PATTERN_CATALOGUE)) if (!key.startsWith("license-")) for (const palette of palettes as readonly string[]) {
      const svg = cardPatternMarkup({ key: key as CardPatternKey, palette: palette as CardPatternTheme, strength: 1 });
      for (const stroke of new Set([...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]!)))
        for (const text of NAME_CARD_TEXT_COLORS) expect(contrast(text, stroke), `${key}/${palette} ${text} on ${stroke}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps the default template's text readable on every license-pattern line (WCAG 4.5:1), and fills only the white base and the flow band", () => {
    for (const { key, palette } of licenseChoices()) {
      const svg = cardPatternMarkup({ key, palette, strength: 1 });
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
      for (const n of cardPatternNodes({ key, palette, strength: 1 }) as BgNode[]) {
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
