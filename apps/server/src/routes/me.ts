import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { eventMembersRepo } from "../db/repositories/eventMembers.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.use("*", requireAuth);

/** マイページ: 開催中 / 過去参加イベント */
meRoutes.get("/events", (c) => {
  const user = c.get("user");
  const now = Date.now();
  const all = eventMembersRepo.listEventsForUser(user.id);
  const ongoing = all.filter((e) => e.endsAt >= now);
  const past = all.filter((e) => e.endsAt < now);
  return c.json({ ongoing, past });
});
