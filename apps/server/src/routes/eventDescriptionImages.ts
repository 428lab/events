import type { Context } from "hono";
import {
  EVENT_DESCRIPTION_IMAGE,
  eventDescriptionImagePath,
  type EventDescriptionImage,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { getBucket } from "../runtime.js";
import { hasImageMagicBytes, normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import { deleteObjects, eventDescriptionImageR2Key } from "../lib/mediaCleanup.js";
import {
  eventDescriptionImagesRepo,
  type EventDescriptionImageRow,
} from "../db/repositories/eventDescriptionImages.js";

/**
 * イベント説明文・参加者限定文章に差し込む画像 (D-DESC-IMAGE)。
 *
 * - 追加・一覧・削除は編集できる人（イベント更新 PATCH と同じ requireEventRole(["staff"])）。
 *   登録は eventCrud.ts
 * - 配信は worker.ts で eventRoutes より先に登録する。手前の requireEventAccess
 *   （イベントを見られる人だけ）を通った後で、推測不能な id でだけ引ける
 * - 受け付けるのは WebP / JPEG・1MB 以内だけ。縮小はブラウザの責務。
 *   Content-Length は信用せず、本文をストリームで数えて上限を超えたら打ち切る
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED_MIMES: ReadonlySet<string> = new Set(EVENT_DESCRIPTION_IMAGE.mimes);

function toView(row: EventDescriptionImageRow): EventDescriptionImage {
  return {
    id: row.id,
    url: eventDescriptionImagePath(row.eventId, row.id),
    size: row.size,
    createdAt: row.createdAt,
  };
}

/** 上限バイト数まで読み、超えたら null。宣言された長さに関係なく実際に流れてきた量で判定する */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** 編集者: 一覧（編集画面の画像トレイ用） */
export async function listEventDescriptionImages(c: Context<AppEnv>) {
  const rows = await eventDescriptionImagesRepo.listByEvent(c.req.param("id")!);
  return c.json({ images: rows.map(toView) });
}

/** 編集者: アップロード（生バイナリ）。R2 に置いてから上限つきで行を入れ、
 * 入らなければ置いた実体を消す（参照されない実体を残さない） */
export async function postEventDescriptionImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  const mime = normalizeImageMime(c.req.header("content-type"));
  if (!mime || !ACCEPTED_MIMES.has(mime)) {
    return c.json({ error: "invalid_content_type" }, 400);
  }
  const maxBytes = EVENT_DESCRIPTION_IMAGE.maxBytes;
  if (Number(c.req.header("content-length") ?? "0") > maxBytes) {
    return c.json({ error: "too_large", maxBytes }, 413);
  }
  const body = await readCapped(c.req.raw.body, maxBytes);
  if (!body) return c.json({ error: "too_large", maxBytes }, 413);
  if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (!hasImageMagicBytes(body.subarray(0, 12), mime)) {
    return c.json({ error: "invalid_image" }, 400);
  }
  // 上限に達していたら R2 に置く前に断る（確定は下の条件付き INSERT）
  const current = await eventDescriptionImagesRepo.listByEvent(eventId);
  if (current.length >= EVENT_DESCRIPTION_IMAGE.maxPerEvent) {
    return c.json({ error: "limit_reached", max: EVENT_DESCRIPTION_IMAGE.maxPerEvent }, 409);
  }

  const row: EventDescriptionImageRow = {
    id: crypto.randomUUID(),
    eventId,
    mime,
    size: body.byteLength,
    createdAt: Date.now(),
  };
  const key = eventDescriptionImageR2Key(eventId, row.id);
  await getBucket().put(key, body, { httpMetadata: { contentType: mime } });
  let inserted: boolean;
  try {
    inserted = await eventDescriptionImagesRepo.insertWithinLimit(row, {
      eventId,
      actorId: c.get("user").id,
      permission: "manager",
    });
  } catch (error) {
    await deleteObjects([key], `[description-image] insert failed event=${eventId}`);
    throw error;
  }
  if (!inserted) {
    await deleteObjects([key], `[description-image] over limit event=${eventId}`);
    return c.json({ error: "limit_reached", max: EVENT_DESCRIPTION_IMAGE.maxPerEvent }, 409);
  }
  return c.json({ image: toView(row) }, 201);
}

/** 編集者: 削除。行を消してから R2 を best-effort で消す（mediaCleanup.ts の順序） */
export async function deleteEventDescriptionImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  const imageId = c.req.param("imageId")!;
  if (!UUID_RE.test(imageId)) return c.json({ error: "not_found" }, 404);
  const deleted = await eventDescriptionImagesRepo.delete(eventId, imageId, {
    eventId,
    actorId: c.get("user").id,
    permission: "manager",
  });
  if (!deleted) return c.json({ error: "not_found" }, 404);
  await deleteObjects(
    [eventDescriptionImageR2Key(eventId, imageId)],
    `[description-image] event=${eventId}`,
  );
  return c.json({ ok: true });
}

/** 配信。手前の requireEventAccess（イベントを見られる人だけ）を通った後で呼ばれる。
 * Cache-Control はその門が private, no-store に揃える（非公開イベントの応答を
 * 共有キャッシュに載せないため。ここで上書きしない） */
export async function getEventDescriptionImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  const imageId = c.req.param("imageId")!;
  if (!UUID_RE.test(imageId)) return c.json({ error: "not_found" }, 404);
  const row = await eventDescriptionImagesRepo.find(eventId, imageId);
  if (!row) return c.json({ error: "not_found" }, 404);
  const obj = await getBucket().get(eventDescriptionImageR2Key(eventId, imageId));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(row.mime),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
