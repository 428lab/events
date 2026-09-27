import { describe, expect, it } from "vitest";
import { countdownSeconds, clockText, resolveLocalTarget } from "./liveTime.js";

describe("live time", () => {
  it("recomputes seconds from wall time and stops or hides at zero", () => {
    expect(countdownSeconds(20_001, 10_000, "stop")).toBe(11);
    expect(countdownSeconds(20_001, 21_000, "stop")).toBe(0);
    expect(countdownSeconds(20_001, 21_000, "hide")).toBeNull();
  });
  it("uses IANA timezone across day boundary and rejects invalid clock", () => {
    expect(clockText(Date.UTC(2026, 0, 1, 15, 0, 8), "Asia/Tokyo", true, true)).toContain("2026/01/02");
    expect(clockText(Number.NaN, "Asia/Tokyo", true, false)).toBeNull();
  });
  it("rejects spring-forward gaps and requires a chosen offset in overlaps", () => {
    expect(resolveLocalTarget("2026-03-08T02:30", "America/New_York")).toEqual([]);
    expect(resolveLocalTarget("2026-11-01T01:30", "America/New_York")).toHaveLength(2);
    expect(resolveLocalTarget("2026-11-01T03:30", "America/New_York")).toHaveLength(1);
  });
});
