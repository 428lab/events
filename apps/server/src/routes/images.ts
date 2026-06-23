import type { Context } from "hono";
import { EVENT_IMAGE } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventImagesRepo } from "../db/repositories/eventImages.js";

/** R2 のオブジェクトキー（イベントごとに1枚） */
const imageKey = (eventId: string) => `event-images/${eventId}`;

/** 公開: イベント画像の取得（認証不要。OGクローラ/表示用。本体は R2、メタは D1） */
export async function getEventImage(c: Context) {
  const eventId = c.req.param("id")!;
  const meta = await eventImagesRepo.getMeta(eventId);
  if (!meta) return c.json({ error: "not_found" }, 404);

  const etag = `"${meta.updatedAt}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304 });
  }
  const obj = await getBucket().get(imageKey(eventId));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": meta.mime,
      "Cache-Control": "public, max-age=60",
      ETag: etag,
    },
  });
}

/** staff/admin: イベント画像のアップロード（生バイナリ、1MB以内の画像） */
export async function putEventImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await eventsRepo.findById(eventId))) {
    return c.json({ error: "not_found" }, 404);
  }

  const mime = c.req.header("content-type") ?? "";
  if (!mime.startsWith("image/")) {
    return c.json({ error: "invalid_content_type" }, 400);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > EVENT_IMAGE.maxBytes) {
    return c.json({ error: "too_large", maxBytes: EVENT_IMAGE.maxBytes }, 413);
  }
  await getBucket().put(imageKey(eventId), body, {
    httpMetadata: { contentType: mime },
  });
  const updatedAt = await eventImagesRepo.upsert(eventId, mime);
  return c.json({ ok: true, imageUpdatedAt: updatedAt });
}

/** staff/admin: イベント画像の削除 */
export async function deleteEventImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  await getBucket().delete(imageKey(eventId));
  await eventImagesRepo.delete(eventId);
  return c.json({ ok: true });
}
