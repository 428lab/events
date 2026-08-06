import type { Context } from "hono";
import { STATS_MAX_DAYS } from "@eventer/shared";
import type { AppEnv } from "../types.js";

/** ?days=N を JST の since 日付に。未指定/0以下は全期間（'0000'）。
 * 既存の統計ページ (adminStatsRoutes) と同じ扱い。
 * 上限を設けないと ?days=1e9 で Date が範囲外になり toISOString() が投げる */
export function kpiPeriodFromQuery(c: Context<AppEnv>): {
  days: number | null;
  sinceDay: string;
} {
  const raw = Number(c.req.query("days"));
  if (!Number.isFinite(raw) || raw <= 0) return { days: null, sinceDay: "0000" };
  const days = Math.min(Math.floor(raw), STATS_MAX_DAYS);
  return {
    days,
    sinceDay: new Date(Date.now() + 9 * 3600 * 1000 - days * 86400000)
      .toISOString()
      .slice(0, 10),
  };
}
