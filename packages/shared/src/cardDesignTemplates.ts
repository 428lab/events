import { cardDesignSchema, isCardPatternChoice, type CardBackground, type CardDesign, type CardPart, type CardPatternKey, type CardPatternTheme } from "./cardDesign.js";

export const cardTemplateIds = ["name", "profile", "role"] as const;
export type CardTemplateId = typeof cardTemplateIds[number];

/** Colour schemes for the templates, separate from the layout. `accent` is the participant heading, role band and role text;
 * `staffAccent` repaints the band and role on staff cards so staff are told apart at a glance. Body text stays #101827.
 * Every accent must keep >= 4.5:1 on white and on each pattern paper: the web adds them to the pattern's legibility list
 * (NAME_CARD_TEXT_COLORS), so the lines are lightened for them. Keep them about as dark as the original teal/rose. */
export const cardTemplateColors = {
  // `earlier`: the lighter teal and rose the template used before, still in saved designs. Recolouring treats them as this scheme.
  teal: { accent: "#11443F", staffAccent: "#701A3E", fallbackPalette: "indigo", staffPalette: "rose", earlier: { accent: ["#0F766E"], staffAccent: ["#9D174D"] } },
  // Nostr purple; staff in a deep vermilion so the two hues sit far apart on the wheel (264 deg vs 18 deg).
  // The background follows too: everyone on the purple pattern, staff on amber (the palette closest to the vermilion band).
  purple: { accent: "#4C1D95", staffAccent: "#742200", fallbackPalette: "purple", staffPalette: "amber", earlier: { accent: [], staffAccent: [] } },
} as const satisfies Record<string, { accent: string; staffAccent: string; fallbackPalette: CardPatternTheme; staffPalette: CardPatternTheme;
  earlier: { accent: readonly string[]; staffAccent: readonly string[] } }>;
export type CardTemplateColorId = keyof typeof cardTemplateColors;
export const cardTemplateColorIds = Object.keys(cardTemplateColors) as CardTemplateColorId[];

/** The parts a scheme paints: the participant heading, role band and role text (common and slot rules), and the staff overrides.
 * `top-band` is the thin top rule of the earlier template, still in saved designs. Only parts still in the old scheme's colour
 * change, so colours the organizer picked by hand are kept. */
const ACCENT_PART_IDS = ["event-title", "role-band", "role", "top-band"] as const;
const repaint = (part: CardPart, from: readonly string[], to: string): CardPart => {
  if (!(ACCENT_PART_IDS as readonly string[]).includes(part.id)) return part;
  const same = (c: string | undefined) => c !== undefined && from.some(f => f.toLowerCase() === c.toLowerCase());
  if (part.kind === "text" && same(part.color)) return { ...part, color: to };
  if (part.kind === "rect") {
    const next = { ...part };
    let changed = false;
    if (same(part.color)) { next.color = to; changed = true; }
    if (same(part.strokeColor)) { next.strokeColor = to; changed = true; }
    return changed ? next : part;
  }
  return part;
};
/** The scheme a design is painted in, read from its participant heading/role colours (common, then slot rules). Null when
 * those parts are gone or were all repainted by hand, so there is nothing to recolour. Derived from the design so undo stays right. */
export function cardTemplateColorsOf(design: CardDesign): CardTemplateColorId | null {
  const colors = [...design.common.parts, ...design.slots.flatMap(s => s.rule.parts)]
    .filter(p => (ACCENT_PART_IDS as readonly string[]).includes(p.id))
    .flatMap(p => p.kind === "text" ? [p.color] : p.kind === "rect" ? [p.color, p.strokeColor] : [])
    .filter((c): c is string => c !== undefined).map(c => c.toLowerCase());
  return cardTemplateColorIds.find(id => {
    const c = cardTemplateColors[id];
    return [c.accent, ...c.earlier.accent].some(a => colors.includes(a.toLowerCase()));
  }) ?? null;
}
/** The same built-in pattern for every card, in the given palette. Keeps the pattern's strength and paper, and the key when it
 * offers that palette (rosette otherwise). Replaces "each member's own card background", which made cards differ per person. */
function uniformBackground(background: CardBackground, palette: CardPatternTheme): CardBackground {
  const pattern = background.pattern;
  const current: string = pattern?.type === "builtin" ? pattern.key : pattern?.type === "participant" ? pattern.fallback.key : "rosette";
  const key = (isCardPatternChoice(current, palette) ? current : "rosette") as CardPatternKey;
  const { assetId: _image, ...rest } = background;
  return { ...rest, pattern: { type: "builtin", key, palette, strength: pattern?.strength ?? 1, paper: pattern?.paper ?? "card" } };
}

/** Whether the design already has the scheme's uniform background (everyone on the same pattern in its palette, staff in theirs). */
export function hasSchemeBackground(design: CardDesign, id: CardTemplateColorId): boolean {
  const c = cardTemplateColors[id];
  const is = (b: CardBackground | undefined, palette: CardPatternTheme) => b?.pattern?.type === "builtin" && b.pattern.palette === palette;
  return is(design.common.background, c.fallbackPalette) && is(design.staff?.background, c.staffPalette)
    && design.slots.every(s => !s.rule.background);
}

/** Change a design from one scheme to another: the accents (keeping the layout, positions and hand-picked colours) and the
 * background, which becomes one built-in pattern for everyone in the scheme's palette, with staff in `staffPalette`.
 * Slot rules lose their own background so every participant matches; staff get theirs on the staff rule. */
export function recolorCardDesign(design: CardDesign, from: CardTemplateColorId, to: CardTemplateColorId): CardDesign {
  const a = cardTemplateColors[from], b = cardTemplateColors[to];
  const accents = [a.accent, ...a.earlier.accent], staffAccents = [a.staffAccent, ...a.earlier.staffAccent];
  const participant = (parts: CardPart[]) => parts.map(p => repaint(p, accents, b.accent));
  const background = uniformBackground(design.common.background, b.fallbackPalette);
  const staff = design.staff ?? { parts: [], hiddenIds: [] };
  return {
    ...design,
    common: { ...design.common, background, parts: participant(design.common.parts) },
    staff: { ...staff, background: uniformBackground(background, b.staffPalette),
      parts: staff.parts.map(p => repaint(p, staffAccents, b.staffAccent)) },
    slots: design.slots.map(s => {
      const { background: _own, ...rule } = s.rule;
      return { ...s, rule: { ...rule, parts: participant(s.rule.parts) } };
    }),
  };
}

/** Every template returns independent, editable parts, never a flattened picture. */
export function createCardTemplate(template: CardTemplateId, colors: CardTemplateColorId = "teal"): CardDesign {
  const scheme = cardTemplateColors[colors];
  const text = (id: string, source: Extract<CardPart, { kind: "text" }>["source"],
    x: number, y: number, width: number, height: number, fontSize: number,
    color = "#101827", bold = false): CardPart => ({
    id, kind: "text", source, text: "", x, y, width, height, fontSize, color, bold,
    align: "start", opacity: 1,
  });
  const parts: CardPart[] = [
    text("event-title", "event", 56, 42, 860, 60, 40, scheme.accent, true),
    text("community", "community", 56, 110, 800, 40, 25),
    text("name", "name", 56, 200, 730, 132, 104, "#101827", true),
    text("handle", "handle", 56, 340, 700, 48, 28),
    text("slot", "slot", 56, 405, 700, 48, 32),
    { id: "avatar", kind: "image", source: "avatar", x: 838, y: 202,
      width: 180, height: 180, fit: "cover", opacity: 1 },
    { id: "profile-qr", kind: "qr", source: "profile", x: 838, y: 414,
      width: 180, height: 180, opacity: 1 },
    // Outline only: a solid band would print a large block of ink.
    { id: "role-band", kind: "rect", x: 56, y: 486, width: 700, height: 108,
      color: scheme.accent, radius: 12, opacity: 1, fill: "none", strokeWidth: 3 },
    text("role", "role", 80, 509, 652, 64, 44, scheme.accent, true),
    // Printed only for members who answered "No photo" in the registration survey.
    { id: "no-photo", kind: "image", source: "noPhoto", x: 930, y: 24,
      width: 120, height: 120, fit: "contain", opacity: 1 },
  ];
  if (template === "profile") {
    // Replaces community, name, handle and slot.
    parts.splice(1, 4,
      text("name", "name", 56, 170, 730, 100, 76, "#101827", true),
      text("handle", "handle", 56, 278, 700, 40, 28),
      { id: "stats", kind: "stats", x: 56, y: 335, width: 700, height: 140,
        color: "#101827", fontSize: 30, opacity: 1 },
    );
  }
  if (template === "role") {
    const role = parts.find(p => p.id === "role")!;
    const band = parts.find(p => p.id === "role-band")!;
    // A wide outline instead of a full-bleed solid band; inset so trimming never cuts the stroke.
    Object.assign(band, { x: 32, y: 152, width: 1010, height: 146, radius: 16, strokeWidth: 4 });
    Object.assign(role, { x: 56, y: 175, width: 962, height: 100, fontSize: 76 });
    Object.assign(parts.find(p => p.id === "name")!, { y: 323, width: 730, height: 110, fontSize: 88 });
    Object.assign(parts.find(p => p.id === "handle")!, { y: 444 });
    Object.assign(parts.find(p => p.id === "slot")!, { y: 517 });
    Object.assign(parts.find(p => p.id === "avatar")!, { y: 316, width: 80, height: 80 });
    // Background decoration must stay behind all text even after moving it.
    parts.splice(parts.indexOf(band), 1);
    parts.unshift(band);
  }
  const band = parts.find(p => p.id === "role-band")!;
  const role = parts.find(p => p.id === "role")!;
  return cardDesignSchema.parse({
    version: 1, enabled: true,
    // Each member's own license-card pattern on the license-card paper; members who never chose one get rosette/indigo.
    // The teal and rose text are dark enough (>= 4.5:1) on every paper tint plus its lines.
    common: { background: { color: "#FFFFFF",
      pattern: { type: "participant", fallback: { key: "rosette", palette: scheme.fallbackPalette }, strength: 1, paper: "card" } }, parts },
    staff: { parts: [{ ...band, color: scheme.staffAccent }, { ...role, color: scheme.staffAccent }] },
    slots: [],
  });
}
