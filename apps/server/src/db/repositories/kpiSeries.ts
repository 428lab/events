import { type KpiDailyPoint, addDays } from "@eventer/shared";
import { N } from "./kpiMetrics.js";

/**
 * 日次系列を「日付の軸」に整える側。**SQL は置かない**（数え方は kpiMetrics.ts、
 * ここは並べ方だけ）。集計クエリを直すときに日付の詰め方まで一緒に読まされない
 * ようにするための切れ目。
 */

/** epoch ms → JST の 'YYYY-MM-DD'（SQL の jd() と同じ基準） */
export function jstDay(at: number): string {
  return new Date(at + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 日次系列の最大点数。?days=3650 のような長い指定でも点数に上限を掛ける。
 * **切り捨てるのは古い側**（開始日をクランプする）。ループの途中で break すると
 * 落ちるのが新しい側になり、直近ぶんが警告も無くグラフから消える。 */
export const MAX_SERIES_POINTS = 3000;

/** 系列の開始日。上限を超える長さのときは「新しい側を必ず残す」ように古い側を切る */
export function clampSeriesStart(first: string, today: string): string {
  const limit = addDays(today, -(MAX_SERIES_POINTS - 1));
  return first < limit ? limit : first;
}

/** 運営ダッシュボードの日次推移クエリ (kpi.ts の (7)) が返す行 */
export interface DailyRow {
  day: string;
  signups: number;
  joins: number;
  held_events: number;
  participations: number;
}

/** DAU/MAU のクエリ (kpi.ts の (8)) が返す行 */
export interface ActiveRow {
  day: string;
  dau: number;
  /** 週次表示になる長さのときは週の最終日（日曜）以外 null（＝算出していない） */
  mau: number | null;
  measured_from: string | null;
}

/** 日次の系列を「抜けの無い日付」に整える (#266)。
 * 活動ゼロの日は 0 で埋める。DAU/MAU は計測開始 (#257) より前を null にして、
 * 「0人だった日」と「まだ計測していない日」を区別する。
 *
 * @param from 期間の開始日。'0000'（全期間）のときはデータのある最初の日 */
export function fillDailySeries(
  from: string,
  today: string,
  daily: DailyRow[],
  active: ActiveRow[],
): KpiDailyPoint[] {
  const measuredFrom = active[0]?.measured_from ?? null;
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const activeByDay = new Map(active.map((a) => [a.day, a]));
  const start =
    from !== "0000"
      ? from
      : [daily[0]?.day, active[0]?.day].filter((d): d is string => !!d).sort()[0];
  if (!start || start > today) return [];
  const first = clampSeriesStart(start, today);

  const out: KpiDailyPoint[] = [];
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const d = byDay.get(day);
    const a = activeByDay.get(day);
    const measured = measuredFrom !== null && day >= measuredFrom;
    out.push({
      day,
      signups: N(d?.signups),
      joins: N(d?.joins),
      heldEvents: N(d?.held_events),
      participations: N(d?.participations),
      dau: measured ? N(a?.dau) : null,
      // MAU は週次表示になる長さのとき週の最終日ぶんだけ算出する（クエリ (8) 参照）。
      // 「計測済みだが算出していない日」を 0 で埋めると MAU が落ちたように見えるので
      // null のまま返す（週次まとめは週の最終の既知値を採る）
      mau: measured ? (a?.mau ?? null) : null,
    });
  }
  return out;
}
