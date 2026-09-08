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
/** 開催前の「いま」 */
const NOW = STARTS - 86400_000;

function ev(over: Partial<Event> = {}): Event {
  return {
    id: "e-1",
    title: "第8回 ナイトハッカソン",
    description: "夜どおしコードを書いて、朝いちばんに発表する。",
    status: "published",
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
const url = (e: Event) => googleCalendarUrl(e, URL_, NOW);
const params = (u: string) => new URL(u).searchParams;

describe("toGoogleUtc", () => {
  it("UTC の YYYYMMDDTHHMMSSZ に直す（JST 18:00 は UTC 09:00）", () => {
    expect(toGoogleUtc(STARTS)).toBe("20260920T090000Z");
  });
  it("ミリ秒は落とし、末尾 Z（UTC）を付ける", () => {
    // Z が無いとローカル形式と解釈され、開いた人の地域で別時刻になる
    expect(toGoogleUtc(STARTS + 123)).toBe("20260920T090000Z");
  });
});

describe("calendarLocation", () => {
  it("オフラインは会場名", () => {
    expect(calendarLocation(ev())).toBe("コワーキング kojira 秋葉原");
  });
  it("オンラインは URL", () => {
    expect(
      calendarLocation(ev({ venueType: "online", venueOffline: null, venueOnline: "https://meet.example.com/x" })),
    ).toBe("https://meet.example.com/x");
  });
  it("ハイブリッドは会場名を優先する（現地に行く人のほうが道に迷う）", () => {
    expect(
      calendarLocation(ev({ venueType: "hybrid", venueOnline: "https://meet.example.com/x" })),
    ).toBe("コワーキング kojira 秋葉原");
  });
  it("ハイブリッドで会場が空ならオンライン URL に落ちる", () => {
    expect(
      calendarLocation(ev({ venueType: "hybrid", venueOffline: "", venueOnline: "https://meet.example.com/x" })),
    ).toBe("https://meet.example.com/x");
  });
  it("オフラインは venueOnline に落ちない（古い URL が残っていても場所に出さない）", () => {
    // ハイブリッド→オフラインに変えても venueOnline は消えない（編集画面が隠すだけ）
    expect(
      calendarLocation(ev({ venueType: "offline", venueOffline: "", venueOnline: "https://stale.example.com" })),
    ).toBe("");
  });
});

describe("calendarDetails", () => {
  it("説明のあとにイベント URL を入れる", () => {
    const d = calendarDetails(ev(), URL_);
    expect(d).toContain("夜どおしコードを書いて");
    expect(d.endsWith(URL_)).toBe(true);
  });
  it("説明が空でも URL だけは必ず入る", () => {
    expect(calendarDetails(ev({ description: "" }), URL_)).toBe(URL_);
  });
  it("Markdown の記号は落とす（カレンダー側にレンダラは無い）", () => {
    const d = calendarDetails(
      ev({ description: "## 見出し\n\n**太字** と [リンク](https://x.example) と ![img](https://i.example/a.png)" }),
      URL_,
    );
    expect(d).toContain("見出し 太字 と リンク と");
    expect(d).not.toMatch(/[#*\[\]()]/);
  });
  it("長い説明はコードポイント単位で切り詰める（絵文字を割らない）", () => {
    const d = calendarDetails(ev({ description: "あ".repeat(499) + "😀" + "x".repeat(50) }), URL_);
    expect(d).toContain("😀");
    expect(d).not.toContain("�");
    expect(d).toContain(URL_);
  });
  it("ハイブリッドはオンラインの参加 URL を本文に載せる（場所欄は会場名になるため）", () => {
    const d = calendarDetails(
      ev({ venueType: "hybrid", venueOnline: "https://meet.example.com/x" }),
      URL_,
    );
    expect(d).toContain("https://meet.example.com/x");
  });
  it("オンライン専用は場所欄に URL が入るので本文には重ねない", () => {
    const d = calendarDetails(
      ev({ venueType: "online", venueOffline: null, venueOnline: "https://meet.example.com/x" }),
      URL_,
    );
    expect(d).not.toContain("https://meet.example.com/x");
  });
});

describe("googleCalendarUrl", () => {
  it("開始と終了を dates= に入れる", () => {
    const p = params(url(ev())!);
    expect(p.get("action")).toBe("TEMPLATE");
    expect(p.get("dates")).toBe("20260920T090000Z/20260920T123000Z");
    expect(p.get("text")).toBe("第8回 ナイトハッカソン");
    expect(p.get("location")).toBe("コワーキング kojira 秋葉原");
  });
  it("Google の render エンドポイントを指す", () => {
    expect(url(ev())).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  });

  describe("出さない条件（呼び出し側には書かない）", () => {
    it("日程調整中（入れる日付が無い）", () => {
      expect(url(ev({ scheduling: true, startsAt: 0, endsAt: 0 }))).toBeNull();
    });
    it("開始が入っていない", () => {
      expect(url(ev({ startsAt: 0 }))).toBeNull();
    });
    it("下書き（本文の /e/:slug が開けない）", () => {
      expect(url(ev({ status: "draft" }))).toBeNull();
    });
    it("終了済み（過去の予定を作っても意味がない）", () => {
      expect(googleCalendarUrl(ev(), URL_, ENDS + 1)).toBeNull();
    });
    it("開催中はまだ出す", () => {
      expect(googleCalendarUrl(ev(), URL_, STARTS + 60_000)).not.toBeNull();
    });
  });

  describe("壊れた終了時刻", () => {
    it("終了が開始より前なら開始と同じにする（壊れた範囲は Google がフォームごと空で開く）", () => {
      const p = params(url(ev({ endsAt: STARTS - 1000 }))!);
      expect(p.get("dates")).toBe("20260920T090000Z/20260920T090000Z");
    });
    it("終了が未設定でも壊れない", () => {
      const p = params(url(ev({ endsAt: 0 }))!);
      expect(p.get("dates")).toBe("20260920T090000Z/20260920T090000Z");
    });
    it("終了が壊れているときの終了判定は開始で見る", () => {
      // endsAt=0 のまま「終了済み」と誤判定して消えない
      expect(googleCalendarUrl(ev({ endsAt: 0 }), URL_, STARTS - 1)).not.toBeNull();
      expect(googleCalendarUrl(ev({ endsAt: 0 }), URL_, STARTS + 1)).toBeNull();
    });
  });

  it("会場が空なら location= を付けない", () => {
    const p = params(url(ev({ venueOffline: "", venueOnline: null }))!);
    expect(p.has("location")).toBe(false);
  });
  it("記号を含むタイトル・会場でも読み返せる（エスケープ）", () => {
    const p = params(url(ev({ title: "LT & 懇親会 #12 (満席)", venueOffline: "A館 1F, 東側" }))!);
    expect(p.get("text")).toBe("LT & 懇親会 #12 (満席)");
    expect(p.get("location")).toBe("A館 1F, 東側");
  });
});
