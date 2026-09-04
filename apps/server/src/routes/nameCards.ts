import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { isConfirmedEventStaff } from "../auth/roles.js";
import { eventsRepo } from "../db/repositories/events.js";
import { nameCardsRepo } from "../db/repositories/nameCards.js";

/**
 * 名札の一括印刷 (#304)。参加確定メンバー全員分のカードデータを返す。
 *
 * 参加者の表示名・ハンドル・アイコン・実績をまとめて渡すので、
 * requireEventRole(["staff"]) ではなく isConfirmedEventStaff で
 * 「そのイベントの参加確定スタッフ」に絞る (#275 と同じ基準)。
 * アプリ運営管理者やコミュニティ管理者は通さない。
 */

const requireEventStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const eventId = c.req.param("id");
  if (!eventId) return c.json({ error: "event_id_required" }, 400);
  if (!(await isConfirmedEventStaff(eventId, c.get("user").id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
};

export const nameCardRoutes = new Hono<AppEnv>();
// 認証は /api/events/* の境界（routes/events.ts）で通っている。ここで重ねない (#472)
nameCardRoutes.use("/:id/name-cards", requireEventStaff);

nameCardRoutes.get("/:id/name-cards", async (c) => {
  const eventId = c.req.param("id");
  if (!(await eventsRepo.findById(eventId))) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ cards: await nameCardsRepo.listForEvent(eventId, Date.now()) });
});
