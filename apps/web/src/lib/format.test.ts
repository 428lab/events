import { describe, it, expect, afterEach } from "vitest";
import type { Event } from "@eventer/shared";
import { i18next } from "../i18n/index.js";
import {
  formatRemaining,
  formatTime,
  participantCountLabel,
  roleLabel,
  showsAttendedCount,
  venueLabel,
} from "./format.js";

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

/**
 * 日時の表示は Intl に timeZone を渡していない＝実行環境の TZ に従うので、
 * テストは vitest.config.ts で日本時間に固定してある (#322)。
 * 固定が外れると「ローカルでは通るが CI では落ちる」という分かりにくい
 * 壊れ方に戻るため、前提そのものをここで見張る。
 */
describe("テストのタイムゾーン (#322)", () => {
  it("日本時間に固定されている", () => {
    expect(process.env.TZ).toBe("Asia/Tokyo");
    expect(new Date().getTimezoneOffset()).toBe(-540);
  });

  it("時刻の表示が実行環境ではなく固定した TZ で出る", () => {
    expect(formatTime(new Date("2026-05-03T13:00:00+09:00").getTime())).toBe(
      "13:00",
    );
  });
});

/**
 * 表示言語で書式が変わること (#352)。
 * **タイムゾーンは端末のまま**なので、#322 の固定はそのまま効く。
 */
describe("表示言語による書式の切り替え (#352)", () => {
  afterEach(async () => {
    await i18next.changeLanguage("ja");
  });

  const AT = new Date("2026-05-03T13:00:00+09:00").getTime();

  it("英語表示でも時刻は日本時間のまま、書式だけ英語になる", async () => {
    expect(formatTime(AT)).toBe("13:00");
    await i18next.changeLanguage("en");
    // 「13時」であることは変わらない（TZ は端末＝テストでは Asia/Tokyo）
    expect(formatTime(AT)).toBe("01:00 PM");
  });

  it("人数の並べ方が言語で変わる", async () => {
    expect(participantCountLabel(ev({ capacityTotal: 21 }), NOW)).toBe(
      "参加 5 / 21 人",
    );
    await i18next.changeLanguage("en");
    expect(participantCountLabel(ev({ capacityTotal: 21 }), NOW)).toBe(
      "5 / 21 joined",
    );
  });

  it("残り時間が言語で変わる", async () => {
    expect(formatRemaining(NOW + 5 * 3600000, NOW)).toBe("あと5時間");
    await i18next.changeLanguage("en");
    expect(formatRemaining(NOW + 5 * 3600000, NOW)).toBe("5h left");
  });

  it("立場・開催形態のラベルが言語で変わる", async () => {
    expect(roleLabel("judge")).toBe("審査員");
    expect(venueLabel("online")).toBe("オンライン");
    await i18next.changeLanguage("en");
    expect(roleLabel("judge")).toBe("Judge");
    expect(venueLabel("online")).toBe("Online");
  });

  it("知らない値はそのまま返す（サーバーが増やしても壊れない）", () => {
    expect(roleLabel("mentor")).toBe("mentor");
    expect(venueLabel("metaverse")).toBe("metaverse");
  });
});
