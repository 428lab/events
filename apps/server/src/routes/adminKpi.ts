import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { kpiRepo } from "../db/repositories/kpi.js";
import { kpiPeriodFromQuery } from "../lib/kpiPeriod.js";

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

/** 運営ダッシュボード (#257 PR1)。/admin/kpi にマウント。app admin のみ */
export const adminKpiRoutes = new Hono<AppEnv>();
adminKpiRoutes.use("*", requireAuth, requireAdmin);
adminKpiRoutes.get("/", async (c) => {
  const { days, sinceDay, prevSinceDay } = kpiPeriodFromQuery(c);
  return c.json(await kpiRepo.overview(sinceDay, prevSinceDay, days));
});
