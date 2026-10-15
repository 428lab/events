import { describe, expect, it } from "vitest";
import { AXIS_DIVISIONS, formatAxisTick, niceAxis } from "./chartAxis.js";

describe("niceAxis", () => {
  it.each([
    [97, [0, 25, 50, 75, 100]],
    [100, [0, 25, 50, 75, 100]],
    [101, [0, 50, 100, 150, 200]],
    [9, [0, 5, 10, 15, 20]],
    [8, [0, 2, 4, 6, 8]],
    [3, [0, 1, 2, 3, 4]],
    [1, [0, 1, 2, 3, 4]],
    [1290, [0, 500, 1000, 1500, 2000]],
    [63, [0, 20, 40, 60, 80]],
    [940, [0, 250, 500, 750, 1000]],
  ])("max %d → ticks %j", (max, ticks) => {
    const axis = niceAxis(max);
    expect(axis.ticks).toEqual(ticks);
    expect(axis.scaleMax).toBe(ticks[ticks.length - 1]);
  });

  it("uses integer ticks with the shared number of divisions and covers the max", () => {
    for (let max = 1; max <= 5000; max += 7) {
      const { ticks, scaleMax } = niceAxis(max);
      expect(ticks).toHaveLength(AXIS_DIVISIONS + 1);
      expect(ticks.every(Number.isInteger)).toBe(true);
      expect(scaleMax).toBeGreaterThanOrEqual(max);
    }
  });

  it("gives an all-zero series a single 0 tick and a non-zero divisor", () => {
    expect(niceAxis(0)).toEqual({ scaleMax: 1, ticks: [0] });
  });
});

describe("formatAxisTick", () => {
  it("shortens thousands so the axis stays narrow", () => {
    expect(formatAxisTick(0)).toBe("0");
    expect(formatAxisTick(750)).toBe("750");
    expect(formatAxisTick(1000)).toBe("1k");
    expect(formatAxisTick(1250)).toBe("1.25k");
    expect(formatAxisTick(20000)).toBe("20k");
  });
});
