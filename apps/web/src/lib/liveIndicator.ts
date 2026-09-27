import type { EventLiveState } from "@eventer/shared";
/** Fails closed on query errors and cached ON values older than five seconds. */
export function canShowLiveIndicator(state: EventLiveState | undefined, updatedAt: number, isError: boolean, endsAt: number | undefined, now: number): boolean {
  return !isError && Boolean(state?.liveIndicatorOn) && updatedAt > 0 && now - updatedAt >= 0 && now - updatedAt < 5000 && (endsAt === undefined || now < endsAt);
}
