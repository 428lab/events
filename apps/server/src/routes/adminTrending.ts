import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { STATS_MAX_DAYS, TRENDING_DEFAULT_DAYS } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { trendingRepo } from "../db/repositories/trending.js";

/** 注目（トレンド）の閲覧（app admin のみ） (#259 PR1)。
 * 公開ランキングではないので、この経路以外からは参照させない */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

export const adminTrendingRoutes = new Hono<AppEnv>();
adminTrendingRoutes.use("*", requireAuth, requireAdmin);

/** GET /api/admin/trending?days=N
 * 「急上昇」は前の同じ長さの期間との比なので全期間は選べない。
 * 未指定・不正な値は TRENDING_DEFAULT_DAYS。上限は既存の統計ページと同じ
 * STATS_MAX_DAYS（クランプしないと Date が範囲外になり toISOString() が投げる） */
adminTrendingRoutes.get("/", async (c) => {
  const raw = Number(c.req.query("days"));
  const days =
    Number.isFinite(raw) && raw >= 1
      ? Math.min(Math.floor(raw), STATS_MAX_DAYS)
      : TRENDING_DEFAULT_DAYS;
  return c.json(await trendingRepo.overview(days, Date.now()));
});
