import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { requireNameCardStaff } from "./nameCards.js";
import { cardDesignsRepo, type CardAssetRow } from "../db/repositories/cardDesigns.js";
import { run, runCount } from "../db/client.js";
import { cardImageDimensions } from "../lib/cardImageDimensions.js";
import { deleteObjects, eventCardAssetR2Key } from "../lib/mediaCleanup.js";

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
  const id = crypto.randomUUID();
  const objectKey = eventCardAssetR2Key(eventId, id);
  // Reserve capacity atomically before R2 work; pending files cannot be saved in a design.
  const inserted = await runCount(`INSERT INTO event_card_asset
    (id, event_id, object_key, content_type, width, height, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM event_card_asset WHERE event_id = ?) < 64`,
    id, eventId, objectKey, mime, dimensions.width, dimensions.height, Date.now(), eventId);
  if (!inserted) return c.json({ error: "card_asset_limit" }, 409);
  try {
    await getBucket().put(objectKey, body, { httpMetadata: { contentType: mime } });
    if (!await runCount("UPDATE event_card_asset SET ready = 1 WHERE id = ? AND event_id = ?", id, eventId))
      throw new Error("event_removed_during_upload");
  } catch (error) {
    // Also covers a concurrent event deletion between reserving metadata and R2 put.
    try { await getBucket().delete(objectKey); }
    catch (cleanupError) { console.error("card_asset_cleanup_failed", { eventId, id, cleanupError }); }
    await run("DELETE FROM event_card_asset WHERE id = ? AND event_id = ?", id, eventId);
    throw error;
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ asset: { id, ...dimensions, contentType: mime,
    url: `/api/events/${encodeURIComponent(eventId)}/name-card-assets/${id}` } }, 201);
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
