import { describe, it, expect } from "vitest";
import type { Event } from "@eventer/shared";
import { participantCountLabel, showsAttendedCount } from "./format.js";

const NOW = new Date("2026-08-07T12:00:00+09:00").getTime();
const DAY = 86400000;

/** 人数表示に必要な項目だけ */
function ev(over: Partial<Event> = {}): Event {
  return {
    attendanceCheck: false,
    scheduling: false,
    startsAt: NOW - DAY,
    participantCount: 5,
    attendedCount: 3,
    capacityTotal: null,
    ...over,
  } as Event;
}

describe("participantCountLabel (#297)", () => {
  it("参加枠があるイベントは上限も出す", () => {
    // 上限は枠の合計＋枠を消費しないメンバー。分子と母集団が揃っている
    expect(participantCountLabel(ev({ capacityTotal: 21 }), NOW)).toBe(
      "参加 5 / 21 人",
    );
  });

  it("参加枠が無いイベントは上限を出さない（上限なしなので）", () => {
    expect(participantCountLabel(ev({ capacityTotal: null }), NOW)).toBe(
      "参加 5 人",
    );
  });

  it("出席も出る場面では上限と両立する", () => {
    expect(
      participantCountLabel(
        ev({ capacityTotal: 21, attendanceCheck: true }),
        NOW,
      ),
    ).toBe("参加 5 / 21 人・出席 3 人");
  });

  it("出席チェックモードでないイベントは、開催後でも参加者数だけ", () => {
    expect(participantCountLabel(ev(), NOW)).toBe("参加 5 人");
    expect(showsAttendedCount(ev(), NOW)).toBe(false);
  });

  it("出席チェックモードの開催前は参加者数だけ（出席0人を並べない）", () => {
    const e = ev({ attendanceCheck: true, startsAt: NOW + DAY, attendedCount: 0 });
    expect(participantCountLabel(e, NOW)).toBe("参加 5 人");
    expect(showsAttendedCount(e, NOW)).toBe(false);
  });

  it("出席チェックモードで開始日時を過ぎたら参加者数と出席者数の両方", () => {
    const e = ev({ attendanceCheck: true, startsAt: NOW - DAY });
    expect(participantCountLabel(e, NOW)).toBe("参加 5 人・出席 3 人");
    expect(showsAttendedCount(e, NOW)).toBe(true);
  });

  it("開始ちょうどは開催後、1ms前は開催前", () => {
    expect(showsAttendedCount(ev({ attendanceCheck: true, startsAt: NOW }), NOW)).toBe(true);
    expect(
      showsAttendedCount(ev({ attendanceCheck: true, startsAt: NOW + 1 }), NOW),
    ).toBe(false);
  });

  it("日程調整中・開始日時未設定は開催前として扱う", () => {
    const scheduling = ev({
      attendanceCheck: true,
      scheduling: true,
      startsAt: 0,
    });
    expect(participantCountLabel(scheduling, NOW)).toBe("参加 5 人");
    // scheduling を解除し忘れても startsAt=0 なら出席は出さない
    const noDate = ev({ attendanceCheck: true, startsAt: 0 });
    expect(participantCountLabel(noDate, NOW)).toBe("参加 5 人");
  });
});
