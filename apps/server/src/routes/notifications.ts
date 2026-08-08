import { Hono } from "hono";
import { NOTIFICATION_PAGE_SIZE } from "@eventer/shared";
import type { NotificationsPayload } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { notificationsRepo } from "../db/repositories/notifications.js";

/** ユーザー向け: /api/notifications（アプリ内通知。push ではない） */
export const notificationRoutes = new Hono<AppEnv>();
notificationRoutes.use("*", requireAuth);

notificationRoutes.get("/unread-count", async (c) => {
  return c.json({ count: await notificationsRepo.unreadCount(c.get("user").id) });
});

/** GET /api/notifications?page=（1ページ NOTIFICATION_PAGE_SIZE 件、新しい順）。
 *
 * 通知は自動で消えないので全件は返さない。通知ベルも一覧 (#294) もここを使い、
 * ベルは1ページ目だけを見る。 */
notificationRoutes.get("/", async (c) => {
  const rawPage = Number.parseInt(c.req.query("page") ?? "1", 10);
  // 上限を設けないと offset が巨大値になり D1 のバインドで 500 になる
  const page =
    Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
  const limit = NOTIFICATION_PAGE_SIZE;
  const userId = c.get("user").id;
  const [notifications, total] = await Promise.all([
    notificationsRepo.listByUser(userId, limit, (page - 1) * limit),
    notificationsRepo.countByUser(userId),
  ]);
  const payload: NotificationsPayload = { notifications, total, page, limit };
  return c.json(payload);
});

notificationRoutes.post("/:id/read", async (c) => {
  await notificationsRepo.markRead(c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

notificationRoutes.post("/read-all", async (c) => {
  await notificationsRepo.markAllRead(c.get("user").id);
  return c.json({ ok: true });
});
