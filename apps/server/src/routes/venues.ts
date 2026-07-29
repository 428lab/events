import { Hono } from "hono";
import type { Context } from "hono";
import {
  createVenueInput,
  updateVenueInput,
  EVENT_PHOTO_MAX_BYTES,
  VENUE_IMAGE,
  VENUE_PHOTO_LIMIT,
  type CreateVenueInput,
  type UpdateVenueInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { getBucket } from "../runtime.js";
import { normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import {
  venuesRepo,
  venueAdminsRepo,
  isVenueManager,
  transferVenueOwnership,
} from "../db/repositories/venues.js";
import { usersRepo } from "../db/repositories/users.js";
import { venuePhotosRepo } from "../db/repositories/venuePhotos.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventRequestsRepo } from "../db/repositories/eventRequests.js";

/** 会場マッチング (#53 PR1)。連絡先はマッチング成立まで非公開（PR2で開示） */

const PAGE_LIMIT = 20;
const r2Key = (id: string) => `venue-images/${id}`;

/** ---- 公開（未ログイン可）: /api/public/venues ---- */
export const publicVenueRoutes = new Hono<AppEnv>();

publicVenueRoutes.get("/", async (c) => {
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const venues = await venuesRepo.listOpen(PAGE_LIMIT, (page - 1) * PAGE_LIMIT);
  const total = await venuesRepo.countOpen();
  return c.json({ venues, total, limit: PAGE_LIMIT });
});

/** 会場を探しているイベント・たまご（会場オーナー向けの募集一覧） */
publicVenueRoutes.get("/wanted", async (c) => {
  const now = Date.now();
  // 開催予定（日程調整中は starts_at=0 でここには出ない）
  const upcoming = await eventsRepo.searchPublished({
    excludeScheduling: true,
    venueWantedOnly: true,
    from: now,
    limit: 50,
    offset: 0,
    sort: "soon",
  });
  // 日程調整中で会場募集中
  const scheduling = (await eventsRepo.listSchedulingPublished(200, 0)).filter(
    (e) => e.venueWanted,
  );
  const requests = await eventRequestsRepo.listPublic(
    { status: "open", venueWantedOnly: true },
    50,
    0,
  );
  return c.json({ events: [...scheduling, ...upcoming], requests });
});

publicVenueRoutes.get("/:id", async (c) => {
  const venue = await venuesRepo.findById(c.req.param("id"));
  if (!venue) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  const isOwner = user?.id === venue.ownerId;
  const isManager = Boolean(
    user && ((await isVenueManager(venue.id, user.id)) || isAppAdmin(user)),
  );
  const ownerUser = await usersRepo.findById(venue.ownerId);
  const owner = ownerUser
    ? {
        id: ownerUser.id,
        username: ownerUser.username,
        globalName: ownerUser.globalName,
        avatarUrl: ownerUser.avatarUrl,
      }
    : null;
  // 運営権（オーナー/管理者）には連絡先・非公開住所込みで返す（編集画面用）
  if (isManager) {
    return c.json({
      venue: await venuesRepo.findByIdFull(venue.id),
      owner,
      isOwner,
      isManager,
    });
  }
  return c.json({ venue, owner, isOwner: false, isManager: false });
});

/** 公開: カバー画像 */
export async function getVenueImage(c: Context<AppEnv>) {
  const id = c.req.param("id")!;
  const updatedAt = await venuesRepo.imageUpdatedAt(id);
  if (!updatedAt) return c.json({ error: "not_found" }, 404);
  const etag = `"${updatedAt}"`;
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304 });
  }
  const obj = await getBucket().get(r2Key(id));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(obj.httpMetadata?.contentType ?? "image/webp"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=60",
      ETag: etag,
    },
  });
}

/** ---- 要ログイン: /api/venues ---- */
export const venueRoutes = new Hono<AppEnv>();
venueRoutes.use("*", requireAuth);

/** 自分の会場一覧（連絡先込み） */
venueRoutes.get("/mine", async (c) => {
  return c.json({ venues: await venuesRepo.listByOwner(c.get("user").id) });
});

venueRoutes.post("/", zValidator("json", createVenueInput), async (c) => {
  const venue = await venuesRepo.create(
    valid<CreateVenueInput>(c, "json"),
    c.get("user").id,
  );
  return c.json({ venue }, 201);
});

/** オーナーのみ（adminは緊急対応でバイパス可）。削除・管理者管理・移譲用 */
async function requireOwner(c: Context<AppEnv>): Promise<Response | null> {
  const ownerId = await venuesRepo.ownerId(c.req.param("id")!);
  if (!ownerId) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  if (ownerId !== user.id && !isAppAdmin(user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

/** 運営権（オーナー or 会場管理者）。編集・写真承認・オファー対応用 */
async function requireManager(c: Context<AppEnv>): Promise<Response | null> {
  const venueId = c.req.param("id")!;
  const ownerId = await venuesRepo.ownerId(venueId);
  if (!ownerId) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  if (!(await isVenueManager(venueId, user.id)) && !isAppAdmin(user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

venueRoutes.patch("/:id", zValidator("json", updateVenueInput), async (c) => {
  const denied = await requireManager(c);
  if (denied) return denied;
  const venue = await venuesRepo.update(
    c.req.param("id"),
    valid<UpdateVenueInput>(c, "json"),
  );
  return c.json({ venue });
});

venueRoutes.delete("/:id", async (c) => {
  const denied = await requireOwner(c);
  if (denied) return denied;
  const id = c.req.param("id");
  await getBucket()
    .delete(r2Key(id))
    .catch(() => undefined);
  // ギャラリー写真の R2 オブジェクトも掃除（DB行は CASCADE で消えるため孤児化を防ぐ）
  try {
    const listed = await getBucket().list({ prefix: `venue-photos/${id}/` });
    if (listed.objects.length > 0) {
      await getBucket().delete(listed.objects.map((o) => o.key));
    }
  } catch {
    // 掃除失敗は削除自体を妨げない
  }
  await venuesRepo.delete(id);
  return c.json({ ok: true });
});

/** 管理者一覧（運営権のある人のみ） */
venueRoutes.get("/:id/admins", async (c) => {
  const denied = await requireManager(c);
  if (denied) return denied;
  return c.json({ admins: await venueAdminsRepo.list(c.req.param("id")) });
});

/** 管理者追加（オーナーのみ。ユーザー名 or ID で指定） */
venueRoutes.post("/:id/admins", async (c) => {
  const denied = await requireOwner(c);
  if (denied) return denied;
  const venueId = c.req.param("id");
  const { handle } = (await c.req.json().catch(() => ({}))) as {
    handle?: string;
  };
  if (!handle?.trim()) return c.json({ error: "handle_required" }, 400);
  const target =
    (await usersRepo.findByUsername(handle.trim())) ??
    (await usersRepo.findById(handle.trim()));
  if (!target) return c.json({ error: "user_not_found" }, 404);
  const ownerId = await venuesRepo.ownerId(venueId);
  if (target.id === ownerId) return c.json({ error: "already_owner" }, 400);
  await venueAdminsRepo.add(venueId, target.id);
  const venue = await venuesRepo.findById(venueId);
  await notificationsRepo.create(
    target.id,
    "info",
    "会場の管理者になりました🏟️",
    venue ? `「${venue.name}」の管理者に追加されました` : "",
    `/venues/${venueId}`,
  );
  return c.json({ admins: await venueAdminsRepo.list(venueId) }, 201);
});

/** 管理者解除（オーナー、または管理者本人が自分を外す） */
venueRoutes.delete("/:id/admins/:userId", async (c) => {
  const venueId = c.req.param("id");
  const targetId = c.req.param("userId");
  const ownerId = await venuesRepo.ownerId(venueId);
  if (!ownerId) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  const isSelf = user.id === targetId;
  if (ownerId !== user.id && !isSelf && !isAppAdmin(user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  await venueAdminsRepo.remove(venueId, targetId);
  return c.json({ admins: await venueAdminsRepo.list(venueId) });
});

/** オーナー移譲（オーナーのみ・移譲先は管理者から選択。旧オーナーは管理者に降格） */
venueRoutes.post("/:id/transfer", async (c) => {
  const denied = await requireOwner(c);
  if (denied) return denied;
  const venueId = c.req.param("id");
  const { userId } = (await c.req.json().catch(() => ({}))) as {
    userId?: string;
  };
  if (!userId) return c.json({ error: "user_required" }, 400);
  if (!(await venueAdminsRepo.isAdmin(venueId, userId))) {
    return c.json({ error: "must_be_admin" }, 400);
  }
  const ownerId = (await venuesRepo.ownerId(venueId))!;
  await transferVenueOwnership(venueId, ownerId, userId);
  const venue = await venuesRepo.findById(venueId);
  await notificationsRepo.create(
    userId,
    "info",
    "会場のオーナーになりました🏟️",
    venue ? `「${venue.name}」のオーナー権限が移譲されました` : "",
    `/venues/${venueId}`,
  );
  return c.json({ ok: true });
});

/** カバー画像アップロード（オーナーのみ） */
venueRoutes.put("/:id/image", async (c) => {
  const denied = await requireManager(c);
  if (denied) return denied;
  const mime = normalizeImageMime(c.req.header("content-type"));
  if (!mime) return c.json({ error: "invalid_content_type" }, 400);
  const maxBytes = VENUE_IMAGE.maxBytes;
  if (Number(c.req.header("content-length") ?? "0") > maxBytes) {
    return c.json({ error: "too_large", maxBytes }, 413);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > maxBytes) {
    return c.json({ error: "too_large", maxBytes }, 413);
  }
  await getBucket().put(r2Key(c.req.param("id")), body, {
    httpMetadata: { contentType: mime },
  });
  const ts = Date.now();
  await venuesRepo.setImageUpdated(c.req.param("id"), ts);
  return c.json({ ok: true, imageUpdatedAt: ts });
});

/* ---- ギャラリー写真 (#63)。イベント写真と同じ検証・R2パターンを流用 ---- */

const photoKey = (venueId: string, photoId: string) =>
  `venue-photos/${venueId}/${photoId}`;

/** 公開: 写真一覧（公開=approvedのみ）。オーナーには審査待ちも返す */
export async function getVenuePhotos(c: Context<AppEnv>) {
  const venue = await venuesRepo.findById(c.req.param("id")!);
  if (!venue) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  const isOwner = Boolean(
    user &&
      ((await isVenueManager(venue.id, user.id)) || isAppAdmin(user)),
  );
  const photos = await venuePhotosRepo.listByVenue(venue.id, "approved");
  const pending = isOwner
    ? await venuePhotosRepo.listByVenue(venue.id, "pending")
    : [];
  // その会場で行われたイベントの参加者なら投稿できる
  const canSubmit = Boolean(
    user &&
      !isOwner &&
      (await venuePhotosRepo.isEventParticipantAtVenue(venue.id, user.id)),
  );
  return c.json({ photos, pending, canSubmit, isOwner, limit: VENUE_PHOTO_LIMIT });
}

/** 写真本体。approved は公開、pending はオーナー/管理者/投稿者本人のみ */
export async function getVenuePhotoImage(c: Context<AppEnv>) {
  const photo = await venuePhotosRepo.findById(c.req.param("photoId")!);
  if (!photo || photo.venueId !== c.req.param("id")) {
    return c.json({ error: "not_found" }, 404);
  }
  let cache = "public, max-age=3600";
  if (photo.status !== "approved") {
    const user = await currentUser(c);
    const allowed =
      user &&
      ((await isVenueManager(photo.venueId, user.id)) ||
        user.id === photo.userId ||
        isAppAdmin(user));
    if (!allowed) return c.json({ error: "not_found" }, 404);
    cache = "private, max-age=0";
  }
  const obj = await getBucket().get(photoKey(photo.venueId, photo.id));
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      "Content-Type": safeServeMime(obj.httpMetadata?.contentType ?? "image/webp"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cache,
    },
  });
}

/** 写真アップロード。オーナー=即公開（上限10点）。
 * その会場で行われたイベントの参加者=審査待ち（オーナーが承認/却下） */
venueRoutes.post("/:id/photos", async (c) => {
  const venueId = c.req.param("id");
  const venue = await venuesRepo.findById(venueId);
  if (!venue) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  const isOwner =
    (await isVenueManager(venueId, user.id)) || isAppAdmin(user);
  if (!isOwner) {
    if (!(await venuePhotosRepo.isEventParticipantAtVenue(venueId, user.id))) {
      return c.json({ error: "forbidden" }, 403);
    }
    // 審査待ちのスパム防止（承認枠と同じ上限）
    if (
      (await venuePhotosRepo.countByVenue(venueId, "pending")) >=
      VENUE_PHOTO_LIMIT
    ) {
      return c.json({ error: "pending_limit", limit: VENUE_PHOTO_LIMIT }, 409);
    }
  } else if (
    (await venuePhotosRepo.countByVenue(venueId, "approved")) >=
    VENUE_PHOTO_LIMIT
  ) {
    return c.json({ error: "photo_limit", limit: VENUE_PHOTO_LIMIT }, 409);
  }
  const mime = normalizeImageMime(c.req.header("content-type"));
  if (!mime) return c.json({ error: "invalid_content_type" }, 400);
  if (Number(c.req.header("content-length") ?? "0") > EVENT_PHOTO_MAX_BYTES) {
    return c.json({ error: "too_large", maxBytes: EVENT_PHOTO_MAX_BYTES }, 413);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > EVENT_PHOTO_MAX_BYTES) {
    return c.json({ error: "too_large", maxBytes: EVENT_PHOTO_MAX_BYTES }, 413);
  }
  const photo = await venuePhotosRepo.create(
    venueId,
    isOwner ? null : user.id,
    isOwner ? "approved" : "pending",
  );
  await getBucket().put(photoKey(venueId, photo.id), body, {
    httpMetadata: { contentType: mime },
  });
  // 参加者投稿はオーナーへ知らせる
  if (!isOwner) {
    await notificationsRepo.create(
      venue.ownerId,
      "venue_photo_result",
      "会場写真の投稿が届きました📷",
      `「${venue.name}」に参加者から写真が投稿されました（承認待ち）`,
      `/venues/${venueId}`,
    );
  }
  return c.json({ photo }, 201);
});

/** 承認/却下（オーナーのみ）。却下は削除し、どちらも投稿者へ通知 */
venueRoutes.post("/:id/photos/:photoId/moderate", async (c) => {
  const denied = await requireManager(c);
  if (denied) return denied;
  const venueId = c.req.param("id");
  const photo = await venuePhotosRepo.findById(c.req.param("photoId"));
  if (!photo || photo.venueId !== venueId || photo.status !== "pending") {
    return c.json({ error: "not_found" }, 404);
  }
  const { action } = (await c.req.json().catch(() => ({}))) as {
    action?: string;
  };
  if (action !== "approve" && action !== "reject") {
    return c.json({ error: "invalid_action" }, 400);
  }
  const venue = await venuesRepo.findById(venueId);
  if (action === "approve") {
    if (
      (await venuePhotosRepo.countByVenue(venueId, "approved")) >=
      VENUE_PHOTO_LIMIT
    ) {
      return c.json({ error: "photo_limit", limit: VENUE_PHOTO_LIMIT }, 409);
    }
    await venuePhotosRepo.setStatus(photo.id, "approved");
    if (photo.userId) {
      await notificationsRepo.create(
        photo.userId,
        "venue_photo_result",
        "会場写真が採用されました🎉",
        venue ? `「${venue.name}」であなたの写真が公開されました` : "",
        `/venues/${venueId}`,
      );
    }
    return c.json({ ok: true, status: "approved" });
  }
  // 却下: R2とDBから削除して通知
  await getBucket()
    .delete(photoKey(venueId, photo.id))
    .catch(() => undefined);
  await venuePhotosRepo.delete(photo.id);
  if (photo.userId) {
    await notificationsRepo.create(
      photo.userId,
      "venue_photo_result",
      "会場写真は見送られました",
      venue ? `「${venue.name}」への投稿写真は公開されませんでした` : "",
      "",
    );
  }
  return c.json({ ok: true, status: "rejected" });
});

/** 写真削除（オーナーのみ） */
venueRoutes.delete("/:id/photos/:photoId", async (c) => {
  const denied = await requireOwner(c);
  if (denied) return denied;
  const photo = await venuePhotosRepo.findById(c.req.param("photoId"));
  if (!photo || photo.venueId !== c.req.param("id")) {
    return c.json({ error: "not_found" }, 404);
  }
  await getBucket()
    .delete(photoKey(photo.venueId, photo.id))
    .catch(() => undefined);
  await venuePhotosRepo.delete(photo.id);
  return c.json({ ok: true });
});
