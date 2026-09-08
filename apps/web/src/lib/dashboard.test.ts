import { describe, it, expect } from "vitest";
import type { MyEventSummary } from "@eventer/shared";
import { dashboardBuckets, isDashboardEmpty, isLive } from "./dashboard.js";

const NOW = new Date("2026-09-20T15:00:00+09:00").getTime();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function ev(over: Partial<MyEventSummary> = {}): MyEventSummary {
  return {
    id: crypto.randomUUID(),
    title: "イベント",
    status: "published",
    scheduling: false,
    startsAt: NOW + DAY,
    endsAt: NOW + DAY + 3 * HOUR,
    myRole: "participant",
    attended: false,
    ...over,
  } as MyEventSummary;
}

describe("isLive", () => {
  it("開始済みで終了前なら開催中", () => {
    expect(isLive(ev({ startsAt: NOW - HOUR, endsAt: NOW + HOUR }), NOW)).toBe(true);
  });

  it("開始前は開催中でない", () => {
    expect(isLive(ev({ startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR }), NOW)).toBe(
      false,
    );
  });

  it("終了後は開催中でない", () => {
    expect(isLive(ev({ startsAt: NOW - 2 * HOUR, endsAt: NOW - HOUR }), NOW)).toBe(
      false,
    );
  });

  it("日程調整中は開催中にならない（開催日が無い）", () => {
    expect(isLive(ev({ scheduling: true, startsAt: 0, endsAt: 0 }), NOW)).toBe(false);
  });
});

describe("dashboardBuckets", () => {
  it("次に近いものを next にする", () => {
    const soon = ev({ title: "近い", startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR });
    const later = ev({ title: "遠い", startsAt: NOW + 5 * DAY, endsAt: NOW + 5 * DAY + HOUR });
    const b = dashboardBuckets([later, soon], NOW);
    expect(b.next?.title).toBe("近い");
    expect(b.upcoming.map((e) => e.title)).toEqual(["遠い"]);
  });

  it("next は upcoming に重複して入らない", () => {
    const b = dashboardBuckets([ev({ title: "A" }), ev({ title: "B", startsAt: NOW + 2 * DAY })], NOW);
    expect(b.next?.title).toBe("A");
    expect(b.upcoming.some((e) => e.title === "A")).toBe(false);
  });

  it("開催中があれば live に入り、next は立てない（同じ日の予定を2か所に出さない）", () => {
    const live = ev({ title: "いま", startsAt: NOW - HOUR, endsAt: NOW + HOUR });
    const future = ev({ title: "あした", startsAt: NOW + DAY });
    const b = dashboardBuckets([future, live], NOW);
    expect(b.live.map((e) => e.title)).toEqual(["いま"]);
    expect(b.next).toBeNull();
    // 開催中に吸われて未来の予定が消えてはいけない
    expect(b.upcoming.map((e) => e.title)).toEqual(["あした"]);
  });

  it("日程調整中は時系列に混ぜず scheduling に分ける", () => {
    // startsAt=0 のまま並べると日付未定が先頭に固まり、直近の予定を押し出す
    const tbd = ev({ title: "調整中", scheduling: true, startsAt: 0, endsAt: 0 });
    const soon = ev({ title: "近い", startsAt: NOW + HOUR });
    const b = dashboardBuckets([tbd, soon], NOW);
    expect(b.next?.title).toBe("近い");
    expect(b.scheduling.map((e) => e.title)).toEqual(["調整中"]);
    expect(b.upcoming).toEqual([]);
  });

  it("下書きはホームに出さない", () => {
    const draft = ev({ title: "下書き", status: "draft", myRole: "staff" });
    const b = dashboardBuckets([draft, ev({ title: "公開" })], NOW);
    expect(b.next?.title).toBe("公開");
    expect(b.upcoming).toEqual([]);
    expect(b.live).toEqual([]);
  });

  it("終了済みが紛れ込んでも next にしない（境界をまたいだページ対策）", () => {
    const done = ev({ title: "終わった", startsAt: NOW - 2 * DAY, endsAt: NOW - DAY });
    const b = dashboardBuckets([done, ev({ title: "これから" })], NOW);
    expect(b.next?.title).toBe("これから");
    expect(b.upcoming).toEqual([]);
  });

  it("主催でも参加でも同じ列に並ぶ（役割で分けない）", () => {
    const staff = ev({ title: "主催", myRole: "staff", startsAt: NOW + HOUR });
    const join = ev({ title: "参加", myRole: "participant", startsAt: NOW + 2 * HOUR });
    const b = dashboardBuckets([join, staff], NOW);
    expect(b.next?.title).toBe("主催");
    expect(b.upcoming.map((e) => e.title)).toEqual(["参加"]);
  });

  it("空でも落ちない", () => {
    expect(dashboardBuckets(undefined, NOW).next).toBeNull();
    expect(dashboardBuckets([], NOW).upcoming).toEqual([]);
  });
});

describe("isDashboardEmpty", () => {
  it("何も無ければ空", () => {
    expect(isDashboardEmpty(dashboardBuckets([], NOW))).toBe(true);
  });

  it("下書きしか無い人も空扱い（ホームに出すものが無い）", () => {
    const b = dashboardBuckets([ev({ status: "draft" })], NOW);
    expect(isDashboardEmpty(b)).toBe(true);
  });

  it("日程調整中だけでも空ではない", () => {
    const b = dashboardBuckets(
      [ev({ scheduling: true, startsAt: 0, endsAt: 0 })],
      NOW,
    );
    expect(isDashboardEmpty(b)).toBe(false);
  });
});
