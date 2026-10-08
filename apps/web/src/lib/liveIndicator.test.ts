import { describe, expect, it } from "vitest";
import { canShowLiveIndicator } from "./liveIndicator.js";
import type { EventLiveState } from "@eventer/shared";
const state = { liveIndicatorOn: true } as EventLiveState;
describe("screen manual LIVE visibility", () => {
  it("requires current live state (successful GET and live signal) and stops after event end", () => {
    expect(canShowLiveIndicator(state, true, 20_000, 2000)).toBe(true);
    expect(canShowLiveIndicator(state, false, 20_000, 2000)).toBe(false);
    expect(canShowLiveIndicator(state, true, 1500, 2000)).toBe(false);
    expect(canShowLiveIndicator({ ...state, liveIndicatorOn: false }, true, undefined, 2000)).toBe(false);
    expect(canShowLiveIndicator(undefined, true, undefined, 2000)).toBe(false);
  });
});
