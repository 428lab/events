import { describe, expect, it } from "vitest";
import { canShowLiveIndicator } from "./liveIndicator.js";
import type { EventLiveState } from "@eventer/shared";
const state = { liveIndicatorOn: true } as EventLiveState;
describe("screen manual LIVE visibility", () => {
  it("requires a fresh successful per-event GET and stops after event end", () => {
    expect(canShowLiveIndicator(state, 1000, false, 20_000, 2000)).toBe(true);
    expect(canShowLiveIndicator(state, 1000, true, 20_000, 2000)).toBe(false);
    expect(canShowLiveIndicator(state, 1000, false, 20_000, 6000)).toBe(false);
    expect(canShowLiveIndicator(state, 1000, false, 1500, 2000)).toBe(false);
    expect(canShowLiveIndicator({ ...state, liveIndicatorOn: false }, 1000, false, undefined, 2000)).toBe(false);
    expect(canShowLiveIndicator(undefined, 1000, false, undefined, 2000)).toBe(false);
  });
});
