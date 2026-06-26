import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { notificationsRepo } from "../db/repositories/notifications.js";

/** ユーザー向け: /api/notifications（アプリ内通知。push ではない） */
export const notificationRoutes = new Hono<AppEnv>();
notificationRoutes.use("*", requireAuth);

notificationRoutes.get("/unread-count", async (c) => {
  return c.json({ count: await notificationsRepo.unreadCount(c.get("user").id) });
});

notificationRoutes.get("/", async (c) => {
  return c.json({
    notifications: await notificationsRepo.listByUser(c.get("user").id),
  });
});

notificationRoutes.post("/:id/read", async (c) => {
  await notificationsRepo.markRead(c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

notificationRoutes.post("/read-all", async (c) => {
  await notificationsRepo.markAllRead(c.get("user").id);
  return c.json({ ok: true });
});
