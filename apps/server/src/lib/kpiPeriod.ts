import type { Context } from "hono";
import { STATS_MAX_DAYS } from "@eventer/shared";
import type { AppEnv } from "../types.js";

export interface KpiPeriod {
  days: number | null;
  /** 今期間の開始日（JST 'YYYY-MM-DD'）。全期間は '0000' */
  sinceDay: string;
  /** 前期間の開始日。前期間は [prevSinceDay, sinceDay) の days 日ぶん。
   * 全期間は比べる過去が無いので sinceDay と同じ '0000' を入れる
   * （SQL の CASE は「今期間」に全部吸われ、前期間は必ず 0 件になる） */
  prevSinceDay: string;
}

/** ?days=N を JST の since 日付に。未指定/0以下は全期間（'0000'）。
 * 既存の統計ページ (adminStatsRoutes) と同じ扱い。
 * 上限を設けないと ?days=1e9 で Date が範囲外になり toISOString() が投げる */
export function kpiPeriodFromQuery(c: Context<AppEnv>): KpiPeriod {
  const raw = Number(c.req.query("days"));
  if (!Number.isFinite(raw) || raw <= 0) {
    return { days: null, sinceDay: "0000", prevSinceDay: "0000" };
  }
  const days = Math.min(Math.floor(raw), STATS_MAX_DAYS);
  const jstNow = Date.now() + 9 * 3600 * 1000;
  const day = (back: number) =>
    new Date(jstNow - back * 86400000).toISOString().slice(0, 10);
  return { days, sinceDay: day(days), prevSinceDay: day(2 * days) };
}
