import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { requireNameCardStaff } from "./nameCards.js";
import { cardDesignsRepo, type CardAssetRow } from "../db/repositories/cardDesigns.js";
import { z } from "zod";
import { cardImageDimensions } from "../lib/cardImageDimensions.js";
import { deleteObjects } from "../lib/mediaCleanup.js";
import { storeCardAsset } from "../lib/cardAssetStorage.js";
import { isConfirmedEventStaff } from "../auth/roles.js";

const MAX_BYTES = 5 * 1024 * 1024;
const MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const info = (a: CardAssetRow) => ({
  id: a.id, width: a.width, height: a.height, contentType: a.content_type,
  url: `/api/events/${encodeURIComponent(a.event_id)}/name-card-assets/${encodeURIComponent(a.id)}`,
});
export const cardDesignAssetRoutes = new Hono<AppEnv>();
cardDesignAssetRoutes.use("/:id/name-card-assets", requireNameCardStaff);
cardDesignAssetRoutes.use("/:id/name-card-assets/*", requireNameCardStaff);

cardDesignAssetRoutes.get("/:id/name-card-assets", async c => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ assets: (await cardDesignsRepo.assets(c.req.param("id"))).map(info) });
});

cardDesignAssetRoutes.post("/:id/name-card-assets", async c => {
  const eventId = c.req.param("id");
  const mime = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!MIME.has(mime)) return c.json({ error: "invalid_content_type" }, 400);
  const body = await c.req.arrayBuffer(); // bounded by worker.ts before reaching this handler
  if (body.byteLength > MAX_BYTES) return c.json({ error: "too_large" }, 413);
  const dimensions = cardImageDimensions(new Uint8Array(body), mime);
  if (!dimensions) return c.json({ error: "invalid_image" }, 400);
  const asset = await storeCardAsset(eventId, body, mime, dimensions);
  if (!asset) return c.json({ error: "card_asset_limit" }, 409);
  c.header("Cache-Control", "private, no-store");
  return c.json({ asset }, 201);
});

// One image per request keeps copying a large template within request/I/O budgets.
cardDesignAssetRoutes.post("/:id/name-card-assets/copy", async c => {
  const parsed = z.object({ sourceEventId: z.string().uuid(), assetId: z.string().uuid() }).strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_copy" }, 400);
  const { sourceEventId, assetId } = parsed.data;
  if (!await isConfirmedEventStaff(sourceEventId, c.get("user").id)) return c.json({ error: "forbidden" }, 403);
  const row = await cardDesignsRepo.asset(sourceEventId, assetId);
  if (!row || !MIME.has(row.content_type)) return c.json({ error: "not_found" }, 404);
  const object = await getBucket().get(row.object_key);
  if (!object) return c.json({ error: "not_found" }, 404);
  if (object.size > MAX_BYTES) { await object.body.cancel(); return c.json({ error: "too_large" }, 413); }
  const body = await object.arrayBuffer();
  const dimensions = cardImageDimensions(new Uint8Array(body), row.content_type);
  if (!dimensions) return c.json({ error: "invalid_image" }, 400);
  const asset = await storeCardAsset(c.req.param("id"), body, row.content_type, dimensions);
  if (!asset) return c.json({ error: "card_asset_limit" }, 409);
  c.header("Cache-Control", "private, no-store");
  return c.json({ asset }, 201);
});

cardDesignAssetRoutes.delete("/:id/name-card-assets/:assetId", async c => {
  const eventId = c.req.param("id"), id = c.req.param("assetId");
  const row = await cardDesignsRepo.asset(eventId, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!await cardDesignsRepo.removeUnusedAsset(eventId, id))
    return c.json({ error: "card_asset_in_use" }, 409);
  await deleteObjects([row.object_key], `[card-asset-delete] event=${eventId}`);
  return c.json({ ok: true });
});

cardDesignAssetRoutes.get("/:id/name-card-assets/:assetId", async c => {
  const row = await cardDesignsRepo.asset(c.req.param("id"), c.req.param("assetId"));
  if (!row || !MIME.has(row.content_type)) return c.json({ error: "not_found" }, 404);
  const object = await getBucket().get(row.object_key);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, { headers: {
    "Content-Type": row.content_type,
    "X-Content-Type-Options": "nosniff",
    // Re-check staff membership on every request, including after leaving an event.
    "Cache-Control": "private, no-store",
  } });
});
