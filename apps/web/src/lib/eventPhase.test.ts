import { describe, expect, it } from "vitest";
import { getEventPhase } from "./eventPhase.js";

/** テストは TZ=Asia/Tokyo 固定（vitest.config.ts）。ローカル日付の境界をそこで確かめる */
const HOUR = 3600000;
const start = new Date("2026-10-10T13:00:00+09:00").getTime();
const end = start + 3 * HOUR;
const published = { status: "published", scheduling: false, startsAt: start, endsAt: end } as const;
const open = { ended: false };

describe("getEventPhase (#613)", () => {
  it("下書きは日程や時刻に関係なく draft", () => {
    expect(getEventPhase({ ...published, status: "draft" }, open, start)).toBe("draft");
    expect(getEventPhase({ ...published, status: "draft", scheduling: true }, { ended: true }, end + HOUR)).toBe("draft");
  });

  it("公開済みで日程調整中なら scheduling", () => {
    expect(getEventPhase({ ...published, scheduling: true, startsAt: 0, endsAt: 0 }, open, start)).toBe("scheduling");
  });

  it("開始日の前日までは upcoming", () => {
    expect(getEventPhase(published, open, new Date("2026-10-09T23:59:59+09:00").getTime())).toBe("upcoming");
    expect(getEventPhase(published, open, start - 7 * 24 * HOUR)).toBe("upcoming");
  });

  it("開始日と同じローカル日付なら開始前でも onDay", () => {
    expect(getEventPhase(published, open, new Date("2026-10-10T00:00:00+09:00").getTime())).toBe("onDay");
    expect(getEventPhase(published, open, start - HOUR)).toBe("onDay");
    expect(getEventPhase(published, open, start + HOUR)).toBe("onDay");
  });

  it("複数日にまたがるイベントは開始〜終了の間ずっと onDay", () => {
    const longEnd = start + 3 * 24 * HOUR;
    expect(getEventPhase({ ...published, endsAt: longEnd }, open, start + 2 * 24 * HOUR)).toBe("onDay");
  });

  it("終了済みは ended（同じ日でも終了が優先）", () => {
    expect(getEventPhase(published, { ended: true }, end + HOUR)).toBe("ended");
  });
});
