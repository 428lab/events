import { cardDesignSchema, type CardDesign, type CardPart } from "./cardDesign.js";

export const cardTemplateIds = ["name", "profile", "role"] as const;
export type CardTemplateId = typeof cardTemplateIds[number];

/** Every template returns independent, editable parts, never a flattened picture. */
export function createCardTemplate(template: CardTemplateId): CardDesign {
  const text = (id: string, source: Extract<CardPart, { kind: "text" }>["source"],
    x: number, y: number, width: number, height: number, fontSize: number,
    color = "#101827", bold = false): CardPart => ({
    id, kind: "text", source, text: "", x, y, width, height, fontSize, color, bold,
    align: "start", opacity: 1,
  });
  const parts: CardPart[] = [
    text("event-title", "event", 56, 42, 860, 60, 40, "#0F766E", true),
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
      color: "#0F766E", radius: 12, opacity: 1, fill: "none", strokeWidth: 3 },
    text("role", "role", 80, 509, 652, 64, 44, "#0F766E", true),
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
    // Each member's own license-card pattern on white; members who never chose one get rosette/indigo.
    common: { background: { color: "#FFFFFF",
      pattern: { type: "participant", fallback: { key: "rosette", palette: "indigo" }, strength: 1 } }, parts },
    staff: { parts: [{ ...band, color: "#9D174D" }, { ...role, color: "#9D174D" }] },
    slots: [],
  });
}
