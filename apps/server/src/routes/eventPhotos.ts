import { Hono } from "hono";
import { EVENT_PHOTO_LIMIT, EVENT_PHOTO_MAX_BYTES } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { getBucket } from "../runtime.js";
import { normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;
const r2Key = (eventId: string, photoId: string) =>
  `event-photos/${eventId}/${photoId}`;

/** イベントフォト。アップロード=参加者、閲覧=参加者のみ、削除=本人+staff */
export const eventPhotoRoutes = new Hono<AppEnv>();
eventPhotoRoutes.use("*", requireAuth);

eventPhotoRoutes.get(
  "/:id/photos",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    return c.json({ photos: await eventPhotosRepo.listByEvent(c.req.param("id")) });
  },
);

/** 写真本体（参加者限定なのでキャッシュは private） */
eventPhotoRoutes.get(
  "/:id/photos/:photoId/image",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const photo = await eventPhotosRepo.findById(c.req.param("photoId"));
    if (!photo || photo.eventId !== c.req.param("id")) {
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
  },
);

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
