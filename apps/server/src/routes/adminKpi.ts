import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { kpiRepo } from "../db/repositories/kpi.js";

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

/** ?days=N を JST の since 日付に。未指定/0以下は全期間（'0000'）。
 * 既存の統計ページ (adminStatsRoutes) と同じ扱い */
function periodFromQuery(c: Context<AppEnv>): {
  days: number | null;
  sinceDay: string;
} {
  const days = Number(c.req.query("days"));
  if (!Number.isFinite(days) || days <= 0) return { days: null, sinceDay: "0000" };
  return {
    days,
    sinceDay: new Date(Date.now() + 9 * 3600 * 1000 - days * 86400000)
      .toISOString()
      .slice(0, 10),
  };
}

/** 運営ダッシュボード (#257 PR1)。/admin/kpi にマウント。app admin のみ */
export const adminKpiRoutes = new Hono<AppEnv>();
adminKpiRoutes.use("*", requireAuth, requireAdmin);
adminKpiRoutes.get("/", async (c) => {
  const { days, sinceDay } = periodFromQuery(c);
  return c.json(await kpiRepo.overview(sinceDay, days));
});
