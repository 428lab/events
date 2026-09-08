import { getBucket } from "../runtime.js";
import { run, runCount } from "../db/client.js";
import { eventCardAssetR2Key } from "./mediaCleanup.js";

/** Upload and authorized event-to-event copy share capacity and cleanup semantics. */
export async function storeCardAsset(eventId: string, body: ArrayBuffer, mime: string, dimensions: { width: number; height: number }) {
  const id = crypto.randomUUID(), objectKey = eventCardAssetR2Key(eventId, id);
  const inserted = await runCount(`INSERT INTO event_card_asset
    (id, event_id, object_key, content_type, width, height, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM event_card_asset WHERE event_id = ?) < 64`,
    id, eventId, objectKey, mime, dimensions.width, dimensions.height, Date.now(), eventId);
  if (!inserted) return null;
  try {
    await getBucket().put(objectKey, body, { httpMetadata: { contentType: mime } });
    if (!await runCount("UPDATE event_card_asset SET ready = 1 WHERE id = ? AND event_id = ?", id, eventId))
      throw new Error("event_removed_during_upload");
  } catch (error) {
    try { await getBucket().delete(objectKey); }
    catch (cleanupError) { console.error("card_asset_cleanup_failed", { eventId, id, cleanupError }); }
    await run("DELETE FROM event_card_asset WHERE id = ? AND event_id = ?", id, eventId);
    throw error;
  }
  return { id, ...dimensions, contentType: mime,
    url: `/api/events/${encodeURIComponent(eventId)}/name-card-assets/${id}` };
}
