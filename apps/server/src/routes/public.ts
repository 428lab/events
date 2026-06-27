import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { currentUser } from "../auth/session.js";
import { eventsRepo } from "../db/repositories/events.js";
import { usersRepo } from "../db/repositories/users.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";
import { communitiesRepo } from "../db/repositories/communities.js";

export const publicRoutes = new Hono<AppEnv>();

/** 公開コミュニティ一覧（未ログイン可） */
publicRoutes.get("/communities", async (c) => {
  return c.json({ communities: await communitiesRepo.list() });
});

/** 公開コミュニティ詳細（未ログイン可。ログイン時は所属/オーナー判定付き） */
publicRoutes.get("/communities/:slug", async (c) => {
  const community = await communitiesRepo.findBySlug(c.req.param("slug"));
  if (!community) return c.json({ error: "not_found" }, 404);
  const user = await currentUser(c);
  const role = user
    ? await communitiesRepo.memberRole(community.id, user.id)
    : null;
  const events = await eventsRepo.listByCommunity(community.id);
  const now = Date.now();
  return c.json({
    ...community,
    isOwner: user ? community.ownerId === user.id : false,
    isMember: Boolean(role),
    upcomingEvents: events.filter((e) => e.endsAt >= now),
    pastEvents: events.filter((e) => e.endsAt < now),
  });
});

/** 公開コミュニティのメンバー一覧 */
publicRoutes.get("/communities/:slug/members", async (c) => {
  const community = await communitiesRepo.findBySlug(c.req.param("slug"));
  if (!community) return c.json({ error: "not_found" }, 404);
  return c.json({ members: await communitiesRepo.listMembers(community.id) });
});

/** 公開ユーザープロフィール（未ログイン可）。アイコン・表示名・公開イベント実績 */
publicRoutes.get("/users/:handle", async (c) => {
  const handle = c.req.param("handle");
  // ハンドル(username)優先、UUID直指定も後方互換で許可
  const user =
    (await usersRepo.findByUsername(handle)) ??
    (await usersRepo.findById(handle));
  if (!user) return c.json({ error: "not_found" }, 404);
  const events = await eventMembersRepo.listPublicEventsForUser(user.id);
  return c.json({
    id: user.id,
    handle: user.username,
    name: user.globalName ?? user.username,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    events,
  });
});

/** 開催前の公開イベント一覧（未ログイン可・開催直前順・ページング） */
publicRoutes.get("/events", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 12) || 12));
  const offset = (page - 1) * limit;
  const now = Date.now();
  const total = await eventsRepo.countUpcomingPublished(now);
  const events = await eventsRepo.listUpcomingPublished(now, limit, offset);
  return c.json({
    events,
    total,
    page,
    limit,
    hasMore: offset + events.length < total,
  });
});

/** 開催済みの公開イベント一覧（未ログイン可・終了が新しい順・ページング） */
publicRoutes.get("/events/past", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 12) || 12));
  const offset = (page - 1) * limit;
  const now = Date.now();
  const total = await eventsRepo.countPastPublished(now);
  const events = await eventsRepo.listPastPublished(now, limit, offset);
  return c.json({
    events,
    total,
    page,
    limit,
    hasMore: offset + events.length < total,
  });
});
