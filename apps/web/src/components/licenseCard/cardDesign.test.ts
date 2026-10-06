import { describe, expect, it } from "vitest";
import {
  cardDesignAssetIds, cardDesignSchema, cardTemplateIds, createCardTemplate,
  resolveCardLayout, DISPLAY_FONTS, CARD_PATTERN_CATALOGUE, type CardDesign,
} from "@eventer/shared";
import { BUILTIN_BACKGROUNDS } from "./builtinBackgrounds.js";
import { BG_VARIANTS, CARD_THEMES } from "./cardTheme.js";

describe("event card design contract (#506)", () => {
  it.each(cardTemplateIds)("%s is editable and does not share state with another event", (id) => {
    const a = createCardTemplate(id), b = createCardTemplate(id);
    const x = b.common.parts[0].x;
    a.common.parts[0].x = 99;
    expect(b.common.parts[0].x).toBe(x);
    expect(cardDesignSchema.safeParse(b).success).toBe(true);
  });

  it.each(cardTemplateIds)("%s carries a No photo mark in a top corner clear of the name (D-NOPHOTO)", (id) => {
    const parts = createCardTemplate(id).common.parts;
    const mark = parts.find(p => p.id === "no-photo")!, name = parts.find(p => p.id === "name")!;
    expect(mark).toMatchObject({ kind: "image", source: "noPhoto" });
    expect(mark.y + mark.height).toBeLessThan(name.y);
    expect(mark.x).toBeGreaterThan(name.x + name.width);
  });

  it("tracks a replaced No photo image as an owned asset", () => {
    const d = createCardTemplate("name");
    const mark = d.common.parts.find(p => p.id === "no-photo")!;
    if (mark.kind !== "image") throw new Error("missing no-photo part");
    expect(cardDesignAssetIds(d)).toEqual([]);
    mark.assetId = "mark-asset";
    expect(cardDesignAssetIds(d)).toEqual(["mark-asset"]);
  });

  it("inherits common parts, applies slot changes, then gives staff changes priority", () => {
    const d = createCardTemplate("name");
    const band = d.common.parts.find(p => p.id === "role-band")!;
    d.slots = [{ slotId: "general", rule: {
      parts: [{ ...band, kind: "rect", color: "#0000FF", radius: 0 }], hiddenIds: ["handle"],
    } }];
    const participant = resolveCardLayout(d, "participant", "general");
    const staff = resolveCardLayout(d, "staff", "general");
    expect(participant.parts.find(p => p.id === "role-band")).toHaveProperty("color", "#0000FF");
    expect(staff.parts.find(p => p.id === "role-band")).toHaveProperty("color", "#9D174D");
    expect(staff.parts.some(p => p.id === "handle")).toBe(false);
    expect(staff.parts.find(p => p.id === "name")).toEqual(d.common.parts.find(p => p.id === "name"));
    expect(resolveCardLayout(d, "participant", null)).toEqual(d.common);
  });

  it("accepts every image-studio font while preserving legacy documents and rejecting arbitrary CSS", () => {
    const design = createCardTemplate("name");
    const part = design.common.parts.find(p => p.kind === "text")!;
    expect(cardDesignSchema.parse(design)).toEqual(design);
    for (const font of DISPLAY_FONTS) {
      part.font = font.family;
      expect(cardDesignSchema.parse(design)).toEqual(design);
    }
    expect(cardDesignSchema.safeParse({ ...design, common: { ...design.common,
      parts: [{ ...part, font: 'url(https://example.com/font.woff)' }],
    } }).success).toBe(false);
  });

  it("tracks assets even in hidden or overridden blocks for ownership checks", () => {
    const d = createCardTemplate("name");
    d.common.background.assetId = "background";
    d.staff!.parts.push({ id: "logo", kind: "image", source: "asset", assetId: "logo",
      x: 0, y: 0, width: 40, height: 40, opacity: 1, fit: "contain" });
    d.staff!.hiddenIds = ["logo"];
    expect(cardDesignAssetIds(d)).toEqual(["background", "logo"]);
  });

  it("rejects executable fields and duplicate ids instead of silently normalizing them", () => {
    const d = createCardTemplate("name");
    expect(cardDesignSchema.safeParse({ ...d, html: "<script>bad()</script>" }).success).toBe(false);
    d.common.parts.push(d.common.parts[0]);
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
  });

  it("rejects coordinates outside print bounds and invalid QR shapes", () => {
    const d = createCardTemplate("name");
    d.common.parts[0].x = 1074;
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
    const qr = createCardTemplate("name");
    qr.common.parts.find(p => p.kind === "qr")!.height = 120;
    expect(cardDesignSchema.safeParse(qr).success).toBe(false);
  });

  it("rejects a foreground part covering the QR quiet zone", () => {
    const d = createCardTemplate("name");
    const qr = d.common.parts.find(p => p.kind === "qr")!;
    d.common.parts.push({ ...qr, id: "cover", kind: "rect", color: "#FFFFFF", radius: 0 });
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
  });

  it("bounds resolved parts, not only each individual rule", () => {
    const d = createCardTemplate("name");
    const block = d.common.parts[0];
    d.common.parts = Array.from({ length: 40 }, (_, i) => ({ ...block, id: `common-${i}` }));
    d.staff = { parts: [{ ...block, id: "additional" }], hiddenIds: [] };
    expect(cardDesignSchema.safeParse(d).success).toBe(false);
  });

  it.each(cardTemplateIds)("%s has no top band, an outline role band and participant backgrounds (D-CARD-BG)", (id) => {
    const d = createCardTemplate(id);
    expect(d.common.parts.some(p => p.id === "top-band")).toBe(false);
    const band = d.common.parts.find(p => p.id === "role-band")!, role = d.common.parts.find(p => p.id === "role")!;
    expect(band).toMatchObject({ kind: "rect", fill: "none", color: "#0F766E" });
    expect(band.kind === "rect" && band.strokeWidth).toBeGreaterThanOrEqual(3);
    expect(role).toMatchObject({ color: "#0F766E" });
    expect(d.common.background.pattern).toEqual({ type: "participant", fallback: { key: "rosette", palette: "indigo" }, strength: 1 });
    const staff = resolveCardLayout(d, "staff", null);
    expect(staff.parts.find(p => p.id === "role-band")).toMatchObject({ color: "#9D174D", fill: "none" });
    expect(staff.parts.find(p => p.id === "role")).toMatchObject({ color: "#9D174D" });
  });
});

describe("card background patterns (D-CARD-BG)", () => {
  const withBackground = (background: Record<string, unknown>) => {
    const d = createCardTemplate("name");
    return { ...d, common: { ...d.common, background: { color: "#FFFFFF", ...background } } };
  };
  it("keeps a saved design without a pattern exactly as it was (no migration)", () => {
    const legacy = withBackground({ assetId: "photo", opacity: 0.4, fit: "contain", positionX: 0, positionY: 1 });
    const parsed = cardDesignSchema.parse(legacy);
    expect(parsed.common.background).toEqual(legacy.common.background);
    expect(parsed.common.background).not.toHaveProperty("pattern");
    // An old rect without the outline fields stays without them.
    const old = createCardTemplate("name");
    const band = old.common.parts.find(p => p.id === "role-band")!;
    if (band.kind !== "rect") throw new Error("fixture");
    delete band.fill; delete band.strokeWidth;
    expect(cardDesignSchema.parse(old).common.parts.find(p => p.id === "role-band")).toEqual(band);
  });
  it("accepts every catalogue choice in both modes and defaults strength to 1", () => {
    for (const [key, palettes] of Object.entries(CARD_PATTERN_CATALOGUE)) for (const palette of palettes) {
      const builtin = cardDesignSchema.parse(withBackground({ pattern: { type: "builtin", key, palette } }));
      expect(builtin.common.background.pattern).toEqual({ type: "builtin", key, palette, strength: 1 });
      expect(cardDesignSchema.safeParse(withBackground({ pattern: { type: "participant", fallback: { key, palette }, strength: 0.4 } })).success).toBe(true);
    }
  });
  it.each([
    ["an unknown key", { type: "builtin", key: "moire", palette: "indigo" }],
    ["a dropped key", { type: "builtin", key: "contours", palette: "teal" }],
    ["a palette the background does not ship", { type: "builtin", key: "ribbons", palette: "mono" }],
    ["an unknown palette", { type: "builtin", key: "rosette", palette: "#000000" }],
    ["an unknown fallback", { type: "participant", fallback: { key: "engine", palette: "rose" } }],
    ["too light", { type: "builtin", key: "rosette", palette: "indigo", strength: 0.3 }],
    ["too strong", { type: "builtin", key: "rosette", palette: "indigo", strength: 1.2 }],
    ["an unknown mode", { type: "photo", key: "rosette", palette: "indigo" }],
    ["extra fields", { type: "builtin", key: "rosette", palette: "indigo", svg: "<path/>" }],
  ])("rejects %s", (_, pattern) => {
    expect(cardDesignSchema.safeParse(withBackground({ pattern })).success).toBe(false);
  });
  it("lets the staff rule override the background while participants keep theirs", () => {
    const d: CardDesign = createCardTemplate("name");
    d.staff = { ...d.staff!, background: { ...d.common.background, pattern: { type: "builtin", key: "mesh", palette: "rose", strength: 1 } } };
    const parsed = cardDesignSchema.parse(d);
    expect(resolveCardLayout(parsed, "staff", null).background.pattern).toMatchObject({ type: "builtin", key: "mesh" });
    expect(resolveCardLayout(parsed, "participant", null).background.pattern).toMatchObject({ type: "participant" });
  });
  it("rejects outline settings outside their bounds", () => {
    const d = createCardTemplate("name");
    const band = d.common.parts.find(p => p.id === "role-band")!;
    expect(cardDesignSchema.safeParse({ ...d, common: { ...d.common, parts: [{ ...band, strokeWidth: 30 }] } }).success).toBe(false);
    expect(cardDesignSchema.safeParse({ ...d, common: { ...d.common, parts: [{ ...band, fill: "gradient" }] } }).success).toBe(false);
    expect(cardDesignSchema.safeParse({ ...d, common: { ...d.common, parts: [{ ...band, strokeColor: "red" }] } }).success).toBe(false);
  });
  it("matches the web catalogue: guilloché keys and palettes, and the license-card patterns × themes", () => {
    const guilloche = Object.fromEntries(BUILTIN_BACKGROUNDS.map(b => [b.key, b.palettes.map(p => p.key)]));
    const license = Object.fromEntries(BG_VARIANTS.map(v => [`license-${v.key}`, CARD_THEMES.map(t => t.key)]));
    expect(Object.fromEntries(Object.entries(CARD_PATTERN_CATALOGUE).map(([k, v]) => [k, [...v]]))).toEqual({ ...guilloche, ...license });
  });
});
