import { resolveCardLayout, type CardDesign, type CardLayout, type CardPart, type CardRule } from "@eventer/shared";

export type EditTarget = "common" | "staff" | `slot:${string}`;
export function targetLayout(doc: CardDesign, target: EditTarget): CardLayout {
  return target === "common" ? doc.common : resolveCardLayout(doc, target === "staff" ? "staff" : "participant",
    target.startsWith("slot:") ? target.slice(5) : null);
}
function ruleFor(doc: CardDesign, target: EditTarget): CardRule {
  if (target === "staff") return doc.staff ??= { parts: [], hiddenIds: [] };
  const slotId = target.slice(5);
  let slot = doc.slots.find(s => s.slotId === slotId);
  if (!slot) { slot = { slotId, rule: { parts: [], hiddenIds: [] } }; doc.slots.push(slot); }
  return slot.rule;
}
export function editPart(doc: CardDesign, target: EditTarget, part: CardPart): CardDesign {
  const next = structuredClone(doc);
  const holder = target === "common" ? next.common : ruleFor(next, target);
  const index = holder.parts.findIndex(p => p.id === part.id);
  if (index >= 0) holder.parts[index] = part; else holder.parts.push(part);
  if ("hiddenIds" in holder) holder.hiddenIds = holder.hiddenIds.filter(id => id !== part.id);
  return next;
}
export function removePart(doc: CardDesign, target: EditTarget, id: string): CardDesign {
  const next = structuredClone(doc);
  if (target === "common") next.common.parts = next.common.parts.filter(p => p.id !== id);
  else {
    const rule = ruleFor(next, target);
    rule.parts = rule.parts.filter(p => p.id !== id);
    rule.hiddenIds = [...new Set([...rule.hiddenIds, id])];
  }
  return next;
}
export function reorderPart(doc: CardDesign, target: EditTarget, id: string, direction: -1 | 1): CardDesign {
  const parts = [...targetLayout(doc, target).parts];
  const index = parts.findIndex(p => p.id === id), to = index + direction;
  if (index < 0 || to < 0 || to >= parts.length) return doc;
  [parts[index], parts[to]] = [parts[to]!, parts[index]!];
  const next = structuredClone(doc);
  if (target === "common") next.common.parts = parts;
  else ruleFor(next, target).order = parts.map(p => p.id);
  return next;
}
export function editBackground(doc: CardDesign, target: EditTarget, background: CardLayout["background"]): CardDesign {
  const next = structuredClone(doc);
  if (target === "common") next.common.background = background;
  else ruleFor(next, target).background = background;
  return next;
}
export function resetRule(doc: CardDesign, target: EditTarget): CardDesign {
  const next = structuredClone(doc);
  if (target === "staff") delete next.staff;
  else if (target.startsWith("slot:")) next.slots = next.slots.filter(s => s.slotId !== target.slice(5));
  return next;
}
export function newPart(kind: CardPart["kind"]): CardPart {
  const box = { id: crypto.randomUUID(), x: 56, y: 160, width: 320, height: 96, opacity: 1 };
  switch (kind) {
    case "rect": return { ...box, kind, color: "#0F766E", radius: 0 };
    case "image": return { ...box, kind, source: "avatar", width: 180, height: 180, fit: "contain" };
    case "qr": return { ...box, kind, source: "profile", width: 180, height: 180 };
    case "stats": return { ...box, kind, color: "#101827", fontSize: 28, height: 140 };
    default: return { ...box, kind, source: "name", text: "", color: "#101827", fontSize: 48, bold: false, align: "start" };
  }
}
export function movePart(part: CardPart, dx: number, dy: number, resize: boolean, gridSize = 0): CardPart {
  if (dx === 0 && dy === 0) return part;
  if (!resize) {
    const snap = (value: number) => Number.isInteger(gridSize) && gridSize > 0
      ? Math.round(value / gridSize) * gridSize : value;
    // Snap absolute card coordinates, then prioritize staying inside the card at its edges.
    return { ...part, x: Math.max(0, Math.min(1074 - part.width, snap(part.x + dx))),
      y: Math.max(0, Math.min(650 - part.height, snap(part.y + dy))) };
  }
  const width = Math.max(part.kind === "qr" ? 120 : 8, Math.min(1074 - part.x, part.width + dx));
  const height = Math.max(part.kind === "qr" ? 120 : 8, Math.min(650 - part.y, part.height + dy));
  return { ...part, width: part.kind === "qr" ? Math.min(width, height) : width,
    height: part.kind === "qr" ? Math.min(width, height) : height };
}
