import { Hono } from "hono";
import { eventsRepo } from "../db/repositories/events.js";

export const publicRoutes = new Hono();

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
