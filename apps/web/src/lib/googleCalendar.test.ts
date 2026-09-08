import { describe, it, expect } from "vitest";
import type { Event } from "@eventer/shared";
import {
  calendarDetails,
  calendarLocation,
  googleCalendarUrl,
  toGoogleUtc,
} from "./googleCalendar.js";

/** JST 2026-09-20 18:00 〜 21:30 */
const STARTS = new Date("2026-09-20T18:00:00+09:00").getTime();
const ENDS = new Date("2026-09-20T21:30:00+09:00").getTime();

function ev(over: Partial<Event> = {}): Event {
  return {
    title: "第8回 ナイトハッカソン",
    description: "夜どおしコードを書いて、朝いちばんに発表する。",
    startsAt: STARTS,
    endsAt: ENDS,
    scheduling: false,
    venueType: "offline",
    venueOffline: "コワーキング kojira 秋葉原",
    venueOnline: null,
    ...over,
  } as Event;
}

const URL_ = "https://events.kojira.io/e/abcd1234";

/** 組み立てた URL のクエリを読み返す */
function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("toGoogleUtc", () => {
  it("UTC の YYYYMMDDTHHMMSSZ に直す", () => {
    // JST 18:00 は UTC 09:00
    expect(toGoogleUtc(STARTS)).toBe("20260920T090000Z");
  });

  it("ミリ秒は落とす（Google は受け付けない）", () => {
    expect(toGoogleUtc(STARTS + 123)).toBe("20260920T090000Z");
  });

  it("ローカル時刻ではなく UTC で出す", () => {
    // 末尾 Z が無いとローカル形式と解釈され、開いた人の地域で別時刻になる
    expect(toGoogleUtc(STARTS).endsWith("Z")).toBe(true);
  });
});

describe("calendarLocation", () => {
  it("オフラインは会場名", () => {
    expect(calendarLocation(ev())).toBe("コワーキング kojira 秋葉原");
  });

  it("オンラインは URL", () => {
    expect(
      calendarLocation(
        ev({ venueType: "online", venueOffline: null, venueOnline: "https://meet.example.com/x" }),
      ),
    ).toBe("https://meet.example.com/x");
  });

  it("ハイブリッドは会場名を優先する（現地に行く人のほうが道に迷う）", () => {
    expect(
      calendarLocation(
        ev({ venueType: "hybrid", venueOnline: "https://meet.example.com/x" }),
      ),
    ).toBe("コワーキング kojira 秋葉原");
  });

  it("ハイブリッドで会場が空ならオンラインURLに落ちる", () => {
    expect(
      calendarLocation(
        ev({ venueType: "hybrid", venueOffline: "", venueOnline: "https://meet.example.com/x" }),
      ),
    ).toBe("https://meet.example.com/x");
  });
});

describe("calendarDetails", () => {
  it("説明のあとにイベントURLを入れる", () => {
    const d = calendarDetails(ev(), URL_);
    expect(d).toContain("夜どおしコードを書いて");
    expect(d).toContain(URL_);
  });

  it("説明が空でもURLだけは必ず入る", () => {
    expect(calendarDetails(ev({ description: "" }), URL_)).toBe(URL_);
  });

  it("長い説明は切り詰める", () => {
    const d = calendarDetails(ev({ description: "あ".repeat(2000) }), URL_);
    expect(d).toContain(URL_);
    expect(d.length).toBeLessThan(600);
  });
});

describe("googleCalendarUrl", () => {
  it("開始と終了を dates= に入れる", () => {
    const p = params(googleCalendarUrl(ev(), URL_)!);
    expect(p.get("action")).toBe("TEMPLATE");
    expect(p.get("dates")).toBe("20260920T090000Z/20260920T123000Z");
    expect(p.get("text")).toBe("第8回 ナイトハッカソン");
    expect(p.get("location")).toBe("コワーキング kojira 秋葉原");
  });

  it("日程調整中は null（入れる日付が無い）", () => {
    expect(googleCalendarUrl(ev({ scheduling: true, startsAt: 0, endsAt: 0 }), URL_)).toBeNull();
  });

  it("開始が入っていなければ null", () => {
    expect(googleCalendarUrl(ev({ startsAt: 0 }), URL_)).toBeNull();
  });

  it("終了が開始より前でも壊れた範囲は作らない（開始と同じにする）", () => {
    // 壊れた dates= を渡すと Google 側がフォームごと空で開く
    const p = params(googleCalendarUrl(ev({ endsAt: STARTS - 1000 }), URL_)!);
    expect(p.get("dates")).toBe("20260920T090000Z/20260920T090000Z");
  });

  it("終了が未設定でも壊れない", () => {
    const p = params(googleCalendarUrl(ev({ endsAt: 0 }), URL_)!);
    expect(p.get("dates")).toBe("20260920T090000Z/20260920T090000Z");
  });

  it("会場が空なら location= を付けない", () => {
    const p = params(
      googleCalendarUrl(ev({ venueOffline: "", venueOnline: null }), URL_)!,
    );
    expect(p.has("location")).toBe(false);
  });

  it("記号を含むタイトル・会場でも読み返せる（エスケープ）", () => {
    const p = params(
      googleCalendarUrl(
        ev({ title: "LT & 懇親会 #12 (満席)", venueOffline: "A館 1F, 東側" }),
        URL_,
      )!,
    );
    expect(p.get("text")).toBe("LT & 懇親会 #12 (満席)");
    expect(p.get("location")).toBe("A館 1F, 東側");
  });

  it("Google の render エンドポイントを指す", () => {
    expect(googleCalendarUrl(ev(), URL_)).toMatch(
      /^https:\/\/calendar\.google\.com\/calendar\/render\?/,
    );
  });
});
