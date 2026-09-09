import { z } from "zod";
import { cardFontSchema } from "./displayFonts.js";

/** Event-only card documents. No HTML, CSS, external URLs or executable markup. */
export const CARD_DESIGN_WIDTH = 1074;
export const CARD_DESIGN_HEIGHT = 650;
export const CARD_DESIGN_MAX_BYTES = 128 * 1024;
export const CARD_DESIGN_MAX_PARTS = 40;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const number = (min: number, max: number) => z.number().finite().min(min).max(max);
const box = {
  id,
  x: number(0, CARD_DESIGN_WIDTH),
  y: number(0, CARD_DESIGN_HEIGHT),
  width: number(8, CARD_DESIGN_WIDTH),
  height: number(8, CARD_DESIGN_HEIGHT),
  opacity: number(0, 1).default(1),
};
export const cardTextSources = [
  "literal", "name", "handle", "event", "community", "role", "slot",
] as const;
export const cardPartSchema = z.discriminatedUnion("kind", [
  z.object({ ...box, kind: z.literal("text"), source: z.enum(cardTextSources),
    text: z.string().max(300).default(""), color, fontSize: number(10, 144),
    font: cardFontSchema.optional(),
    bold: z.boolean().default(false), align: z.enum(["start", "middle", "end"]).default("start"),
  }).strict(),
  z.object({ ...box, kind: z.literal("image"), source: z.enum(["avatar", "community", "asset"]),
    assetId: id.optional(), fit: z.enum(["contain", "cover"]).default("contain"),
  }).strict(),
  z.object({ ...box, kind: z.literal("rect"), color, radius: number(0, 100).default(0) }).strict(),
  z.object({ ...box, kind: z.literal("qr"), source: z.enum(["profile", "event"]) }).strict(),
  z.object({ ...box, kind: z.literal("stats"), color, fontSize: number(10, 72) }).strict(),
]);
export type CardPart = z.infer<typeof cardPartSchema>;
export const cardBackgroundSchema = z.object({
  color,
  assetId: id.optional(),
  opacity: number(0, 1).default(0.25),
  fit: z.enum(["contain", "cover"]).default("cover"),
  positionX: number(0, 1).default(0.5),
  positionY: number(0, 1).default(0.5),
}).strict();
const parts = z.array(cardPartSchema).max(CARD_DESIGN_MAX_PARTS);
export const cardLayoutSchema = z.object({ background: cardBackgroundSchema, parts }).strict();
/** Rules replace only edited blocks, leaving other common blocks inherited. */
const ruleSchema = z.object({
  background: cardBackgroundSchema.optional(),
  parts: parts.default([]),
  hiddenIds: z.array(id).max(CARD_DESIGN_MAX_PARTS).default([]),
  order: z.array(id).max(CARD_DESIGN_MAX_PARTS).refine(ids => new Set(ids).size === ids.length).optional(),
}).strict();
export const cardDesignSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  common: cardLayoutSchema,
  staff: ruleSchema.optional(),
  slots: z.array(z.object({ slotId: id, rule: ruleSchema }).strict()).max(32).default([]),
}).strict().superRefine((doc, ctx) => {
  const check = (list: CardPart[], path: (string | number)[]) => {
    if (new Set(list.map(p => p.id)).size !== list.length)
      ctx.addIssue({ code: "custom", message: "duplicate_part_id", path });
    list.forEach((p, i) => {
      if (p.x + p.width > CARD_DESIGN_WIDTH || p.y + p.height > CARD_DESIGN_HEIGHT)
        ctx.addIssue({ code: "custom", message: "part_outside_card", path: [...path, i] });
      if (p.kind === "qr" && (p.width !== p.height || p.width < 120 || p.opacity !== 1))
        ctx.addIssue({ code: "custom", message: "qr_requires_opaque_square_min_120", path: [...path, i] });
      if (p.kind === "image" && p.source === "asset" && !p.assetId)
        ctx.addIssue({ code: "custom", message: "asset_required", path: [...path, i] });
    });
  };
  check(doc.common.parts, ["common", "parts"]);
  if (doc.staff) check(doc.staff.parts, ["staff", "parts"]);
  doc.slots.forEach((s, i) => check(s.rule.parts, ["slots", i, "rule", "parts"]));
  if (new Set(doc.slots.map(s => s.slotId)).size !== doc.slots.length)
    ctx.addIssue({ code: "custom", message: "duplicate_slot_rule", path: ["slots"] });
  if (cardDesignAssetIds(doc).length > 64)
    ctx.addIssue({ code: "custom", message: "too_many_assets" });
  // Bound the resolved layout too: rules can add blocks as well as replace them.
  for (const slot of [null, ...doc.slots.map(s => s.slotId)]) {
    for (const role of ["participant", "staff"]) {
      const resolved = resolveCardLayout(doc, role, slot).parts;
      if (resolved.length > CARD_DESIGN_MAX_PARTS)
        ctx.addIssue({ code: "custom", message: "too_many_resolved_parts" });
      resolved.forEach((p, i) => {
        if (p.kind === "qr" && resolved.slice(i + 1).some(q => q.opacity > 0 &&
          q.x < p.x + p.width && q.x + q.width > p.x && q.y < p.y + p.height && q.y + q.height > p.y))
          ctx.addIssue({ code: "custom", message: "qr_obscured", path: ["common", "parts", p.id] });
      });
    }
  }
});
export type CardDesign = z.infer<typeof cardDesignSchema>;
export type CardLayout = z.infer<typeof cardLayoutSchema>;
export type CardRule = z.infer<typeof ruleSchema>;
export interface SavedCardDesign { revision: number; design: CardDesign | null }

export function applyCardRule(layout: CardLayout, rule?: CardRule): CardLayout {
  if (!rule) return layout;
  const replacements = new Map(rule.parts.map(p => [p.id, p]));
  const hidden = new Set(rule.hiddenIds);
  const existing = new Set(layout.parts.map(p => p.id));
  const parts = [
    ...layout.parts.map(p => replacements.get(p.id) ?? p),
    ...rule.parts.filter(p => !existing.has(p.id)),
  ].filter(p => !hidden.has(p.id));
  if (rule.order) {
    const ranks = new Map(rule.order.map((id, i) => [id, i]));
    parts.sort((a, b) => (ranks.get(a.id) ?? parts.length) - (ranks.get(b.id) ?? parts.length));
  }
  return { background: rule.background ?? layout.background, parts };
}

/** slotId must come from the event's current membership, not a caller-selected rule. */
export function resolveCardLayout(design: CardDesign, role: string, slotId: string | null): CardLayout {
  const slot = design.slots.find(s => s.slotId === slotId)?.rule;
  const layout = applyCardRule(design.common, slot);
  return applyCardRule(layout, role === "staff" ? design.staff : undefined);
}

/** Include hidden/overridden assets too: saved edits must remain usable when restored. */
export function cardDesignAssetIds(design: CardDesign): string[] {
  const refs = new Set<string>();
  for (const layout of [design.common, design.staff, ...design.slots.map(s => s.rule)]) {
    if (layout?.background?.assetId) refs.add(layout.background.assetId);
    for (const p of layout?.parts ?? [])
      if (p.kind === "image" && p.source === "asset" && p.assetId) refs.add(p.assetId);
  }
  return [...refs].sort();
}
