import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { sendEventReminders } from "../lib/reminders.js";
import { purgeDeletedAccounts } from "../lib/purgeDeleted.js";

/** 前日リマインダーの手動実行 (#126)。staging 検証・本番の補完用（app admin のみ）。
 * staging は cron を張らないため、動作確認はこのエンドポイントで行う */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

export const adminReminderRoutes = new Hono<AppEnv>();
adminReminderRoutes.use("*", requireAuth, requireAdmin);
adminReminderRoutes.post("/", async (c) => {
  const sent = await sendEventReminders();
  return c.json({ sent });
});

/** 退会猶予期間 (#250) を過ぎたアカウントの完全削除の手動実行（app admin のみ）。
 * staging は GHA の定時実行を張らないため、動作確認はこのエンドポイントで行う */
export const adminPurgeDeletedRoutes = new Hono<AppEnv>();
adminPurgeDeletedRoutes.use("*", requireAuth, requireAdmin);
adminPurgeDeletedRoutes.post("/", async (c) => {
  return c.json(await purgeDeletedAccounts());
});
