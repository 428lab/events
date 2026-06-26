import { Hono } from "hono";
import { eventsRepo } from "../db/repositories/events.js";
import { usersRepo } from "../db/repositories/users.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

export const publicRoutes = new Hono();

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
