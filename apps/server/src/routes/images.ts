import type { Context } from "hono";
import { EVENT_IMAGE } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventImagesRepo } from "../db/repositories/eventImages.js";

/** 公開: イベント画像の取得（認証不要。OGクローラ/表示用） */
export function getEventImage(c: Context) {
  const eventId = c.req.param("id")!;
  const img = eventImagesRepo.get(eventId);
  if (!img) return c.json({ error: "not_found" }, 404);

  const etag = `"${img.updatedAt}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304 });
  }
  return new Response(img.data, {
    headers: {
      "Content-Type": img.mime,
      "Cache-Control": "public, max-age=60",
      ETag: etag,
    },
  });
}

/** staff/admin: イベント画像のアップロード（生バイナリ、1MB以内の画像） */
export async function putEventImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!eventsRepo.findById(eventId)) return c.json({ error: "not_found" }, 404);

  const mime = c.req.header("content-type") ?? "";
  if (!mime.startsWith("image/")) {
    return c.json({ error: "invalid_content_type" }, 400);
  }
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (buf.byteLength > EVENT_IMAGE.maxBytes) {
    return c.json({ error: "too_large", maxBytes: EVENT_IMAGE.maxBytes }, 413);
  }
  const updatedAt = eventImagesRepo.upsert(eventId, mime, buf);
  return c.json({ ok: true, imageUpdatedAt: updatedAt });
}

/** staff/admin: イベント画像の削除 */
export function deleteEventImage(c: Context<AppEnv>) {
  eventImagesRepo.delete(c.req.param("id")!);
  return c.json({ ok: true });
}
