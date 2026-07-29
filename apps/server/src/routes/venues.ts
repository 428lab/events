import { Hono } from "hono";
import type { Context } from "hono";
import {
  createVenueInput,
  updateVenueInput,
  VENUE_IMAGE,
  type CreateVenueInput,
  type UpdateVenueInput,
} from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { currentUser, requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { valid, zValidator } from "../lib/validator.js";
import { getBucket } from "../runtime.js";
import { normalizeImageMime, safeServeMime } from "../lib/imageMime.js";
import { venuesRepo } from "../db/repositories/venues.js";
import { usersRepo } from "../db/repositories/users.js";
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
  const ownerUser = await usersRepo.findById(venue.ownerId);
  const owner = ownerUser
    ? {
        id: ownerUser.id,
        username: ownerUser.username,
        globalName: ownerUser.globalName,
        avatarUrl: ownerUser.avatarUrl,
      }
    : null;
  // オーナー本人には連絡先・非公開住所込みで返す（編集画面用）
  if (isOwner || (user && isAppAdmin(user))) {
    return c.json({
      venue: await venuesRepo.findByIdFull(venue.id),
      owner,
      isOwner,
    });
  }
  return c.json({ venue, owner, isOwner: false });
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

/** オーナーのみ（adminは緊急対応でバイパス可） */
async function requireOwner(c: Context<AppEnv>): Promise<Response | null> {
  const ownerId = await venuesRepo.ownerId(c.req.param("id")!);
  if (!ownerId) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  if (ownerId !== user.id && !isAppAdmin(user)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return null;
}

venueRoutes.patch("/:id", zValidator("json", updateVenueInput), async (c) => {
  const denied = await requireOwner(c);
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
  await getBucket()
    .delete(r2Key(c.req.param("id")))
    .catch(() => undefined);
  await venuesRepo.delete(c.req.param("id"));
  return c.json({ ok: true });
});

/** カバー画像アップロード（オーナーのみ） */
venueRoutes.put("/:id/image", async (c) => {
  const denied = await requireOwner(c);
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
