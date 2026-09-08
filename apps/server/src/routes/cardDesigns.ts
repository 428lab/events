import { Hono } from "hono";
import { z } from "zod";
import { CARD_DESIGN_MAX_BYTES, cardDesignAssetIds, cardDesignSchema } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireNameCardStaff } from "./nameCards.js";
import { cardDesignsRepo } from "../db/repositories/cardDesigns.js";
import { many } from "../db/client.js";

export const cardDesignRoutes = new Hono<AppEnv>();
cardDesignRoutes.use("/:id/name-card-design", requireNameCardStaff);
cardDesignRoutes.use("/:id/name-card-design/*", requireNameCardStaff);

cardDesignRoutes.get("/:id/name-card-design", async c => {
  c.header("Cache-Control", "private, no-store");
  return c.json(await cardDesignsRepo.get(c.req.param("id")));
});

const saveSchema = z.object({
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  design: cardDesignSchema,
}).strict();

cardDesignRoutes.put("/:id/name-card-design", async c => {
  const eventId = c.req.param("id");
  // worker.ts already bounds the incoming stream; this is the smaller document limit.
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > CARD_DESIGN_MAX_BYTES)
    return c.json({ error: "too_large" }, 413);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return c.json({ error: "invalid_card_design" }, 400); }
  const parsed = saveSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: "invalid_card_design" }, 400);
  const { design, revision } = parsed.data;
  const [assets, slots] = await Promise.all([
    cardDesignsRepo.assets(eventId),
    many<{ id: string }>("SELECT id FROM participation_slot WHERE event_id = ?", eventId),
  ]);
  const owned = new Set(assets.map(a => a.id));
  if (cardDesignAssetIds(design).some(id => !owned.has(id)))
    return c.json({ error: "invalid_card_asset" }, 400);
  const slotIds = new Set(slots.map(s => s.id));
  if (design.slots.some(s => !slotIds.has(s.slotId)))
    return c.json({ error: "invalid_card_slot" }, 400);
  try {
    if (!await cardDesignsRepo.save(eventId, revision, design))
      return c.json({ error: "card_design_conflict" }, 409);
  } catch (error) {
    // An asset can disappear after the ownership read. The FK rolls back the whole write.
    if (error instanceof Error && error.message.includes("FOREIGN KEY"))
      return c.json({ error: "card_asset_unavailable" }, 409);
    throw error;
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ revision: revision + 1, design });
});
