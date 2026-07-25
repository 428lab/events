import { Hono } from "hono";
import type { Context } from "hono";
import { EVENT_PHOTO_LIMIT, EVENT_PHOTO_MAX_BYTES } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { getBucket } from "../runtime.js";
import { normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;
const r2Key = (eventId: string, photoId: string) =>
  `event-photos/${eventId}/${photoId}`;

/** 写真を閲覧できるか。photos_public 公開イベントは誰でも、
 * それ以外はメンバー/管理者のみ */
async function canViewPhotos(eventId: string, c: Context): Promise<boolean> {
  const event = await eventsRepo.findById(eventId);
  if (!event) return false;
  if (event.photosPublic && event.status === "published") return true;
  const user = await currentUser(c);
  if (!user) return false;
  if (isAppAdmin(user)) return true;
  return Boolean(await eventMembersRepo.find(eventId, user.id));
}

/* ===== 公開ハンドラ（未ログイン可。worker.ts で eventRoutes より先に登録） ===== */

/** 写真一覧 */
export async function getEventPhotos(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ photos: await eventPhotosRepo.listByEvent(eventId) });
}

/** 写真本体 */
export async function getEventPhotoImage(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const photo = await eventPhotosRepo.findById(c.req.param("photoId")!);
  if (!photo || photo.eventId !== eventId) {
    return c.json({ error: "not_found" }, 404);
  }
  const obj = await getBucket().get(r2Key(photo.eventId, photo.id));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(obj.httpMetadata?.contentType),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/* ===== 書き込み（要認証。アップロード・削除はメンバーのみ） ===== */

export const eventPhotoRoutes = new Hono<AppEnv>();
eventPhotoRoutes.use("*", requireAuth);

/** アップロード（生バイナリ） */
eventPhotoRoutes.post(
  "/:id/photos",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const mime = normalizeImageMime(c.req.header("content-type"));
    if (!mime) return c.json({ error: "invalid_content_type" }, 400);
    if (Number(c.req.header("content-length") ?? "0") > EVENT_PHOTO_MAX_BYTES) {
      return c.json({ error: "too_large", maxBytes: EVENT_PHOTO_MAX_BYTES }, 413);
    }
    if ((await eventPhotosRepo.countByEvent(eventId)) >= EVENT_PHOTO_LIMIT) {
      return c.json({ error: "photo_limit", limit: EVENT_PHOTO_LIMIT }, 409);
    }
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
    if (body.byteLength > EVENT_PHOTO_MAX_BYTES) {
      return c.json({ error: "too_large", maxBytes: EVENT_PHOTO_MAX_BYTES }, 413);
    }
    const photoId = await eventPhotosRepo.create(eventId, c.get("user").id);
    await getBucket().put(r2Key(eventId, photoId), body, {
      httpMetadata: { contentType: mime },
    });
    return c.json({ photo: await eventPhotosRepo.findById(photoId) }, 201);
  },
);

/** 削除（本人 or staff/管理者） */
eventPhotoRoutes.delete(
  "/:id/photos/:photoId",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const user = c.get("user");
    const photo = await eventPhotosRepo.findById(c.req.param("photoId"));
    if (!photo || photo.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    if (photo.userId !== user.id && !isAppAdmin(user)) {
      const member = await eventMembersRepo.find(eventId, user.id);
      if (member?.role !== "staff") return c.json({ error: "forbidden" }, 403);
    }
    await getBucket().delete(r2Key(eventId, photo.id));
    await eventPhotosRepo.delete(photo.id);
    return c.json({ ok: true });
  },
);
