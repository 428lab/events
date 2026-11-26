import { describe, expect, it } from "vitest";
import {
  CARD_PATTERN_CATALOGUE, cardTemplateColors, cardTemplateColorsOf, cardTemplateIds, createCardTemplate, recolorCardDesign,
  type CardPart, type CardPatternKey, type CardPatternTheme,
} from "@eventer/shared";
import { NAME_CARD_TEXT_COLORS } from "./builtinBackgrounds.js";
import before from "./__fixtures__/cardTemplates-2e7a222.json";
import { cardPatternMarkup } from "./cardPattern.js";

/** Template colour schemes (オーナー 2026-11-27「Nostrなのでテンプレに紫が欲しい」). */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const color = (parts: CardPart[], id: string) => {
  const p = parts.find(x => x.id === id)!;
  return p.kind === "text" || p.kind === "rect" ? p.color : undefined;
};

describe("card template colour schemes", () => {
  it("keeps the default (teal) templates byte-identical to before the colour choice existed", () => {
    // Captured from main 2e7a222 before this change (createCardTemplate(id) for every layout).
    for (const id of cardTemplateIds) expect(createCardTemplate(id), id).toEqual((before as Record<string, unknown>)[id]);
  });

  it("purple: participant and staff accents are clearly different, and every accent reads on white and on every pattern line", () => {
    const purple = cardTemplateColors.purple;
    let gap = Math.abs(hue(purple.accent) - hue(purple.staffAccent)); gap = Math.min(gap, 360 - gap);
    expect(gap).toBeGreaterThanOrEqual(90);
    const accents = Object.values(cardTemplateColors).flatMap(c => [c.accent, c.staffAccent]);
    for (const accent of accents) {
      expect(NAME_CARD_TEXT_COLORS).toContain(accent);
      expect(contrast(accent, "#FFFFFF"), accent).toBeGreaterThanOrEqual(4.5);
    }
    // Lines on white, every pattern × palette: the scheme accents sit on them as text.
    for (const [key, palettes] of Object.entries(CARD_PATTERN_CATALOGUE)) for (const palette of palettes as readonly CardPatternTheme[]) {
      const svg = cardPatternMarkup({ key: key as CardPatternKey, palette, strength: 1, paper: "none" });
      for (const stroke of new Set([...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]!)))
        for (const accent of accents) expect(contrast(accent, stroke), `${key}/${palette} ${accent} on ${stroke}`).toBeGreaterThanOrEqual(4.5);
    }
    const design = createCardTemplate("name", "purple");
    expect(color(design.common.parts, "role")).toBe(purple.accent);
    expect(color(design.staff!.parts, "role")).toBe(purple.staffAccent);
  });

  it("changing colours only repaints the template-coloured accent parts and keeps positions and hand-picked colours", () => {
    const design = createCardTemplate("name");
    const moved = {
      ...design,
      common: { ...design.common, parts: design.common.parts.map(p =>
        p.id === "role-band" ? { ...p, x: 70 } : p.id === "event-title" ? { ...p, color: "#123456" } : p) },
      slots: [{ slotId: "slot-1", rule: { parts: [{ ...design.common.parts.find(p => p.id === "role")!, color: "#0F766E", fontSize: 50 }], hiddenIds: [] } }],
    };
    // The earlier template's thin top rule, still in saved designs (e.g. Nostrasia's), follows the scheme too.
    moved.common.parts = [{ id: "top-band", kind: "rect", x: 0, y: 0, width: 1074, height: 12, opacity: 1, color: "#0F766E", radius: 0 }, ...moved.common.parts];
    expect(cardTemplateColorsOf(moved)).toBe("teal");
    const out = recolorCardDesign(moved, "teal", "purple");
    expect(cardTemplateColorsOf(out)).toBe("purple");
    expect(color(out.common.parts, "role")).toBe("#4C1D95");
    expect(color(out.common.parts, "role-band")).toBe("#4C1D95");
    expect(color(out.common.parts, "top-band")).toBe("#4C1D95");
    expect(out.common.parts.find(p => p.id === "role-band")!.x).toBe(70);
    expect(color(out.common.parts, "event-title")).toBe("#123456"); // picked by hand: kept
    expect(color(out.common.parts, "name")).toBe("#101827"); // body text is not an accent
    expect(color(out.slots[0]!.rule.parts, "role")).toBe("#4C1D95"); // the older template teal counts as teal
    expect(out.slots[0]!.rule.parts[0]!.kind === "text" && out.slots[0]!.rule.parts[0]!.fontSize).toBe(50);
    expect(out.staff!.parts.map(p => color([p], p.id))).toEqual(["#742200", "#742200"]);
    // Everything else is untouched, and going back restores the original.
    expect(recolorCardDesign(out, "purple", "teal").common.parts).toEqual(moved.common.parts.map(p =>
      p.id === "role" || p.id === "role-band" || p.id === "top-band" ? { ...p, color: "#11443F" } : p));
  });

  // オーナー 2026-11-27「スタッフなのに色がバラバラだ」「Nostrパープルにしても何も変わらなかった」:
  // the background was each member's own card pattern, so the scheme must also make it uniform.
  it("changing colours also puts everyone on the same pattern in the scheme's palette, staff in theirs, keeping strength and paper", () => {
    const design = createCardTemplate("name");
    design.common.background.pattern = { type: "participant", fallback: { key: "mesh", palette: "indigo" }, strength: 0.6, paper: "none" };
    design.slots = [{ slotId: "slot-1", rule: { parts: [], hiddenIds: [], background: { ...design.common.background, color: "#FFEEEE" } } }];
    const out = recolorCardDesign(design, "teal", "purple");
    expect(out.common.background.pattern).toEqual({ type: "builtin", key: "mesh", palette: "purple", strength: 0.6, paper: "none" });
    expect(out.staff!.background!.pattern).toEqual({ type: "builtin", key: "mesh", palette: "amber", strength: 0.6, paper: "none" });
    expect(out.slots[0]!.rule.background).toBeUndefined();
    // A pattern that doesn't offer the palette falls back to rosette (every pattern offers purple now).
    for (const palettes of Object.values(CARD_PATTERN_CATALOGUE)) expect(palettes).toContain("purple");
    expect(cardTemplateColors.purple.fallbackPalette).toBe("purple");
    expect(createCardTemplate("name", "purple").common.background.pattern).toMatchObject({ type: "participant", fallback: { palette: "purple" } });
  });
});
