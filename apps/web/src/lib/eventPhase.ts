import type { Event } from "@eventer/shared";
import type { EventTiming } from "./useEventTiming.js";

/** スタッフの「今やること」を決めるイベントの時期 (#613) */
export type EventPhase = "draft" | "scheduling" | "upcoming" | "onDay" | "ended";

function sameLocalDate(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * イベントの時期を返す (#613)。
 *
 * - draft: 下書き
 * - scheduling: 公開済みで日程調整中
 * - ended: 終了済み（判定は useEventTiming に揃える）
 * - onDay: 開始日と同じローカル日付、または開始〜終了の間
 * - upcoming: それ以外（日程確定・開始日の前日まで）
 *
 * 終了済みは当日より優先する（同じ日に終わったイベントは「当日」ではなく「終了」）。
 */
export function getEventPhase(
  event: Pick<Event, "status" | "scheduling" | "startsAt" | "endsAt">,
  timing: Pick<EventTiming, "ended">,
  now: number,
): EventPhase {
  if (event.status === "draft") return "draft";
  if (event.scheduling) return "scheduling";
  if (timing.ended) return "ended";
  if (sameLocalDate(event.startsAt, now) || (event.startsAt <= now && now <= event.endsAt)) return "onDay";
  return "upcoming";
}
