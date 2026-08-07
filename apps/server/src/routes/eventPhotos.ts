import { Hono } from "hono";
import type { Context } from "hono";
import {
  EVENT_PHOTO_LIMIT,
  EVENT_PHOTO_MAX_BYTES,
  PHOTO_COMMENT_LIMIT,
  createPhotoCommentInput,
} from "@eventer/shared";
import type { CreatePhotoCommentInput } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth, currentUser } from "../auth/session.js";
import { isConfirmedEventStaff, requireEventRole } from "../auth/roles.js";
import { isAppAdmin } from "../auth/admin.js";
import { getBucket } from "../runtime.js";
import { valid, zValidator } from "../lib/validator.js";
import { normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventPhotosRepo } from "../db/repositories/eventPhotos.js";
import { eventPhotoCommentsRepo } from "../db/repositories/eventPhotoComments.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

const MEMBER_ROLES = ["participant", "staff", "judge", "observer"] as const;
/** R2 のキー。管理画面 (#278) も同じ実体を配信するのでここから使う */
export const photoR2Key = (eventId: string, photoId: string) =>
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
  const member = await eventMembersRepo.find(eventId, user.id);
  if (!member) return false;
  // 出席チェックモードでは、参加者ロールは出席チェック済みのみ閲覧可
  // （参加人数カウント COUNTS_AS_PARTICIPANT と同じ基準）
  if (event.attendanceCheck && member.role === "participant" && !member.attended) {
    return false;
  }
  return true;
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
  const obj = await getBucket().get(photoR2Key(photo.eventId, photo.id));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(obj.httpMetadata?.contentType),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** 写真コメント一覧（閲覧できる人は誰でも） */
export async function getPhotoComments(c: Context<AppEnv>) {
  const eventId = c.req.param("id")!;
  if (!(await canViewPhotos(eventId, c))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const photo = await eventPhotosRepo.findById(c.req.param("photoId")!);
  if (!photo || photo.eventId !== eventId) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({
    comments: await eventPhotoCommentsRepo.listByPhoto(photo.id),
  });
}

/* ===== 書き込み（要認証。アップロード・コメント・削除はメンバーのみ） ===== */

export const eventPhotoRoutes = new Hono<AppEnv>();
eventPhotoRoutes.use("*", requireAuth);

/** コメント投稿（メンバー。他人の写真にも複数可） */
eventPhotoRoutes.post(
  "/:id/photos/:photoId/comments",
  requireEventRole([...MEMBER_ROLES]),
  zValidator("json", createPhotoCommentInput),
  async (c) => {
    const eventId = c.req.param("id");
    const photo = await eventPhotosRepo.findById(c.req.param("photoId"));
    if (!photo || photo.eventId !== eventId) {
      return c.json({ error: "not_found" }, 404);
    }
    if ((await eventPhotoCommentsRepo.countByPhoto(photo.id)) >= PHOTO_COMMENT_LIMIT) {
      return c.json({ error: "comment_limit", limit: PHOTO_COMMENT_LIMIT }, 409);
    }
    const comment = await eventPhotoCommentsRepo.create(
      photo.id,
      c.get("user").id,
      valid<CreatePhotoCommentInput>(c, "json").body,
    );
    return c.json({ comment }, 201);
  },
);

/** コメント削除（投稿者本人 or **そのイベントの参加確定 staff メンバー**）。
 * 他人のコメントを消すのはイベント内コンテンツのモデレーションなので、
 * サイト管理者・コミュニティ管理者というだけでは通さない (#275) */
eventPhotoRoutes.delete(
  "/:id/photos/:photoId/comments/:commentId",
  requireEventRole([...MEMBER_ROLES]),
  async (c) => {
    const eventId = c.req.param("id");
    const user = c.get("user");
    const comment = await eventPhotoCommentsRepo.findById(
      c.req.param("commentId"),
    );
    if (!comment || comment.photoId !== c.req.param("photoId")) {
      return c.json({ error: "not_found" }, 404);
    }
    if (
      comment.userId !== user.id &&
      !(await isConfirmedEventStaff(eventId, user.id))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    await eventPhotoCommentsRepo.delete(comment.id);
    return c.json({ ok: true });
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
    await getBucket().put(photoR2Key(eventId, photoId), body, {
      httpMetadata: { contentType: mime },
    });
    return c.json({ photo: await eventPhotosRepo.findById(photoId) }, 201);
  },
);

/** 削除（投稿者本人 or **そのイベントの参加確定 staff メンバー**）。
 * 他人の写真を消すのはイベント内コンテンツのモデレーションなので、
 * サイト管理者・コミュニティ管理者というだけでは通さない (#275) */
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
    if (
      photo.userId !== user.id &&
      !(await isConfirmedEventStaff(eventId, user.id))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    await getBucket().delete(photoR2Key(eventId, photo.id));
    await eventPhotosRepo.delete(photo.id);
    return c.json({ ok: true });
  },
);
