import type { EventLiveState } from "@eventer/shared";
/** Fails closed unless the live state is current (last GET succeeded and the `live` signal
 * subscription is live, useEventLiveState's `current`), and after the event ends. */
export function canShowLiveIndicator(state: EventLiveState | undefined, stateCurrent: boolean, endsAt: number | undefined, now: number): boolean {
  return stateCurrent && Boolean(state?.liveIndicatorOn) && (endsAt === undefined || now < endsAt);
}
