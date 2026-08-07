import type { Context } from "hono";
import { STATS_MAX_DAYS } from "@eventer/shared";
import type { AppEnv } from "../types.js";

export interface KpiPeriod {
  days: number | null;
  /** 今期間の開始日（JST 'YYYY-MM-DD'）。全期間は '0000'。
   * 今期間は [sinceDay, 今日] で、今日を含むので **days + 1 日ぶん** */
  sinceDay: string;
  /** 前期間の開始日。前期間は [prevSinceDay, sinceDay) で、
   * 今期間と**同じ days + 1 日ぶん**にする。
   * ここを days 日にすると、毎日同じ件数が入る横ばいのデータでも
   * 今期間だけ1日ぶん多くなり、count/avg 系の指標がすべて増加方向に振れる
   * （7日レンジで +14.3%、30日レンジで +3.3%）。
   *
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
  // 今期間 [day(days), 今日] は days + 1 日ぶんなので、前期間も同じ日数にする
  return { days, sinceDay: day(days), prevSinceDay: day(2 * days + 1) };
}
