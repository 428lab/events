import { cardDesignAssetIds, cardDesignSchema, type CardDesign, type SavedCardDesign } from "@eventer/shared";
import { api } from "../../api/client.js";
import type { CardAsset } from "../../api/cardDesignHooks.js";

/** Copies only from this deployment, with fresh authorization on every private read. */
export async function copyEventDesign(targetId: string, sourceInput: string, targetSlots: { id: string; name: string }[]) {
  let source = sourceInput.trim();
  if (source.includes(":")) {
    const url = new URL(source);
    if (url.origin !== window.location.origin) throw new Error("different_environment");
    source = decodeURIComponent(/^\/events\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? "");
  }
  if (!source || source.length > 100 || source.includes("/")) throw new Error("invalid_event");
  const event = await api.get<{ event: { id: string } }>(`/events/${encodeURIComponent(source)}`);
  const sourceId = event.event.id;
  if (sourceId === targetId) throw new Error("same_event");
  const saved = await api.get<SavedCardDesign>(`/events/${sourceId}/name-card-design`);
  if (!saved.design) throw new Error("no_design");
  const sourceSlots = await api.get<{ slots: { id: string; name: string }[] }>(`/events/${sourceId}/slots`);
  const design: CardDesign = structuredClone(saved.design);
  const originalSlotCount = design.slots.length;
  design.slots = design.slots.flatMap(entry => {
    const name = sourceSlots.slots.find(s => s.id === entry.slotId)?.name;
    const targets = targetSlots.filter(s => s.name === name);
    return targets.length === 1 && sourceSlots.slots.filter(s => s.name === name).length === 1
      ? [{ ...entry, slotId: targets[0]!.id }] : [];
  });
  const ids = cardDesignAssetIds(design), copied: CardAsset[] = [];
  const mapping = new Map<string, string>();
  try {
    // Sequential copying bounds memory and preserves an exact cleanup list on failure.
    for (const assetId of ids) {
      const { asset } = await api.post<{ asset: CardAsset }>(`/events/${targetId}/name-card-assets/copy`, { sourceEventId: sourceId, assetId });
      copied.push(asset); mapping.set(assetId, asset.id);
    }
    for (const layout of [design.common, design.staff, ...design.slots.map(s => s.rule)]) {
      if (layout?.background?.assetId) layout.background.assetId = mapping.get(layout.background.assetId);
      for (const part of layout?.parts ?? []) if (part.kind === "image" && part.source === "asset" && part.assetId)
        part.assetId = mapping.get(part.assetId);
    }
    return { design: cardDesignSchema.parse(design), assets: copied, skippedSlots: originalSlotCount - design.slots.length };
  } catch (error) {
    for (const asset of copied) {
      try { await api.del(`/events/${targetId}/name-card-assets/${asset.id}`); }
      catch { /* Still owned/listed by the target event; never delete a now-used image. */ }
    }
    throw error;
  }
}
