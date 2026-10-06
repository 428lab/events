import { describe, expect, it } from "vitest";
import { cardPatternMarkup, cardPatternNodes, resolveCardPattern } from "./cardPattern.js";
import { builtinBackgroundNodes } from "./builtinBackgrounds.js";

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
  it("draws license-card patterns on white without the paper gradient, scaling line opacity by strength", () => {
    const full = cardPatternMarkup({ key: "license-topo", palette: "teal", strength: 1 });
    const half = cardPatternMarkup({ key: "license-topo", palette: "teal", strength: 0.5 });
    expect(full).toContain('fill="#FFFFFF"');
    expect(full).not.toMatch(/Gradient|<filter|url\(/);
    const opacities = (svg: string) => [...svg.matchAll(/opacity="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(opacities(half)).toEqual(opacities(full).map(o => o * 0.5));
    expect(full).toContain("#0D9488"); // teal accentA
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
});
