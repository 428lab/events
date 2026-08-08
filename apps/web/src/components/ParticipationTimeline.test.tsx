import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EventTimelinePhotos, MyEventSummary } from "@eventer/shared";
import { ParticipationTimeline } from "./ParticipationTimeline.js";

/**
 * 参加履歴の年表 (#308, #315)。
 *
 * 「どのイベントに行ったか」が一目で追えることが目的なので、
 * 年で区切られること・新しい順に並ぶこと・関わり方が添うこと・
 * 情報密度（時刻/会場/参加人数）が保たれることを確かめる。
 * #315 で足した区分フィルタ・出会い数・写真サムネイルもここで見る。
 */

const ME = "u-me";

function ev(over: Partial<MyEventSummary> = {}): MyEventSummary {
  return {
    id: "e-1",
    title: "テストイベント",
    subtitle: "",
    description: "",
    status: "published",
    scheduling: false,
    startsAt: new Date("2024-05-03T13:00:00+09:00").getTime(),
    endsAt: new Date("2024-05-03T18:00:00+09:00").getTime(),
    venueType: "offline",
    venueOffline: "山形",
    venueOnline: null,
    attendanceCheck: false,
    participantCount: 5,
    attendedCount: 0,
    capacityTotal: null,
    createdBy: "u-owner",
    imageUpdatedAt: null,
    myRole: "participant",
    attended: false,
    ...over,
  } as MyEventSummary;
}

/** 2026-08-09 12:00 JST を「いま」として描画する */
const NOW = new Date("2026-08-09T12:00:00+09:00").getTime();

function renderTimeline(
  events: MyEventSummary[],
  opts: {
    speakerEventIds?: string[];
    meetCounts?: Record<string, number>;
    eventPhotos?: EventTimelinePhotos[];
  } = {},
) {
  return render(
    <MemoryRouter>
      <ParticipationTimeline
        events={events}
        userId={ME}
        speakerEventIds={opts.speakerEventIds ?? []}
        meetCounts={opts.meetCounts}
        eventPhotos={opts.eventPhotos}
        now={NOW}
      />
    </MemoryRouter>,
  );
}

/** 年見出しのピル（年 or 日程調整中）を DOM 順に拾う */
const past = (iso: string) => ({
  startsAt: new Date(iso).getTime(),
  endsAt: new Date(iso).getTime() + 5 * 3600_000,
});

describe("参加履歴の年表", () => {
  it("年のピル型ラベルで区切られ、全体を通して新しい順に並ぶ", () => {
    const { container } = renderTimeline([
      ev({ id: "past-2024", title: "2024年のイベント" }),
      ev({
        id: "past-2025",
        title: "2025年のイベント",
        ...past("2025-11-01T10:00:00+09:00"),
      }),
      ev({
        id: "future",
        title: "これから行くイベント",
        ...past("2026-10-01T10:00:00+09:00"),
      }),
    ]);

    const text = container.textContent ?? "";
    const positions = [
      "2026",
      "これから行くイベント",
      "2025",
      "2025年のイベント",
      "2024",
      "2024年のイベント",
    ].map((s) => text.indexOf(s));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("日程調整中は日付の代わりに調整中と出て、先頭のかたまりに入る", () => {
    const { container } = renderTimeline([
      ev({ id: "old", title: "去年のイベント" }),
      ev({
        id: "sched",
        title: "日程が決まっていないイベント",
        scheduling: true,
        startsAt: 0,
        endsAt: 0,
      }),
    ]);
    const text = container.textContent ?? "";
    expect(text.indexOf("日程調整中")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("日程が決まっていないイベント")).toBeLessThan(
      text.indexOf("去年のイベント"),
    );
  });

  it("カードに日付・時刻・会場・参加人数が出る（情報密度を落とさない）", () => {
    renderTimeline([
      ev({
        id: "dense",
        title: "密度のイベント",
        venueOffline: "Tokyo Bitcoin Base",
        participantCount: 42,
      }),
    ]);
    expect(screen.getByText("2024.05.03")).toBeTruthy();
    expect(screen.getByText("13:00–18:00")).toBeTruthy();
    expect(screen.getByText("Tokyo Bitcoin Base")).toBeTruthy();
    expect(screen.getByText("参加 42 人")).toBeTruthy();
  });

  it("関わり方が添う（主催・スタッフ・審査員・登壇）。ただの参加者は「参加」", () => {
    renderTimeline(
      [
        ev({ id: "own", title: "自分が立てた回", myRole: "staff", createdBy: ME }),
        ev({ id: "help", title: "手伝った回", myRole: "staff" }),
        ev({ id: "judge", title: "審査した回", myRole: "judge" }),
        ev({ id: "talk", title: "話した回" }),
        ev({ id: "plain", title: "参加しただけの回" }),
      ],
      { speakerEventIds: ["talk"] },
    );
    expect(screen.getByText("主催")).toBeTruthy();
    expect(screen.getByText("スタッフ")).toBeTruthy();
    expect(screen.getByText("審査員")).toBeTruthy();
    expect(screen.getByText("登壇")).toBeTruthy();
    // 役割が無い回は「参加」として塗り分けられる
    expect(screen.getAllByText("参加").length).toBeGreaterThan(0);
  });

  describe("区分フィルタ", () => {
    const events = [
      ev({ id: "h-past", title: "主催した回", myRole: "staff", createdBy: ME }),
      ev({
        id: "h-future",
        title: "主催する回",
        myRole: "staff",
        createdBy: ME,
        ...past("2026-12-01T10:00:00+09:00"),
      }),
      ev({ id: "j-past", title: "参加した回" }),
    ];

    it("チップに件数が出て、押すと絞り込まれる", () => {
      renderTimeline(events);
      // 初期はすべて表示
      expect(screen.getByText("表示中 3 件 ・ 出会いの記録 0 件")).toBeTruthy();

      fireEvent.click(screen.getByText("主催・運営 2"));
      // 画像の無いイベントはバナーにもタイトルを敷くので2か所に出る
      expect(screen.getAllByText("主催した回").length).toBeGreaterThan(0);
      expect(screen.queryByText("参加した回")).toBeNull();
      expect(screen.getByText("表示中 2 件 ・ 出会いの記録 0 件")).toBeTruthy();
    });

    it("件数はもう一方の絞り込みを反映する", () => {
      renderTimeline(events);
      fireEvent.click(screen.getByText("これから 1"));
      // これから に絞ると、区分の件数も その中での数 になる
      expect(screen.getByText("主催・運営 1")).toBeTruthy();
      expect(screen.getByText("参加 0")).toBeTruthy();
    });

    it("組み合わせて0件になったら空状態を出す", () => {
      renderTimeline(events);
      fireEvent.click(screen.getByText("これから 1"));
      fireEvent.click(screen.getByText("参加 0"));
      expect(screen.getByText("これから × 参加 の履歴はまだありません")).toBeTruthy();
      expect(screen.queryByText("主催する回")).toBeNull();
    });
  });

  describe("出会い数", () => {
    it("出会った人数がメタ行に出て、合計も添う", () => {
      renderTimeline(
        [
          ev({ id: "met", title: "出会いのあった回" }),
          ev({ id: "alone", title: "出会いのなかった回", ...past("2023-05-03T13:00:00+09:00") }),
        ],
        { meetCounts: { met: 23 } },
      );
      expect(screen.getByText("出会った 23 人")).toBeTruthy();
      // 年表下部はカードの合計なので延べ件数。上部の「出会った人（実人数）」とは別物
      expect(screen.getByText("表示中 2 件 ・ 出会いの記録 23 件")).toBeTruthy();
    });

    it("0人のイベントは項目ごと出さない", () => {
      renderTimeline([ev({ id: "alone", title: "ひとりの回" })], {
        meetCounts: { alone: 0 },
      });
      // 集計行の「このうち出会った人 0 人」とは別に、カードのメタ行には出さない
      expect(screen.queryByText(/^出会った \d+ 人$/)).toBeNull();
    });
  });

  describe("公開写真のサムネイル", () => {
    const photos: EventTimelinePhotos[] = [
      {
        eventId: "p-ev",
        photos: [
          { id: "ph-mid", commentCount: 8 },
          { id: "ph-top", commentCount: 12 },
          { id: "ph-low", commentCount: 1 },
        ],
        total: 5,
      },
    ];

    it("コメントの多い順に並び、数字は出さず、残りは +N で示す", () => {
      const { container } = renderTimeline(
        [ev({ id: "p-ev", title: "写真のある回" })],
        { eventPhotos: photos },
      );
      const srcs = [...container.querySelectorAll("img")].map((i) =>
        i.getAttribute("src"),
      );
      expect(srcs).toEqual([
        "/api/events/p-ev/photos/ph-top/image",
        "/api/events/p-ev/photos/ph-mid/image",
        "/api/events/p-ev/photos/ph-low/image",
      ]);
      // 並び順の基準にしか使わないので、コメント数そのものは画面に出さない
      expect(screen.queryByText("12")).toBeNull();
      expect(screen.queryByText("8")).toBeNull();
      expect(screen.getByText("+2")).toBeTruthy();
    });

    it("押すと拡大表示が開き、前後にたどれる", () => {
      renderTimeline([ev({ id: "p-ev", title: "写真のある回" })], {
        eventPhotos: photos,
      });
      fireEvent.click(screen.getByLabelText("写真1枚目を拡大表示"));
      const dialog = screen.getByRole("dialog");
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        "/api/events/p-ev/photos/ph-top/image",
      );
      expect(within(dialog).getByText("1 / 3")).toBeTruthy();

      fireEvent.click(within(dialog).getByLabelText("次の写真"));
      expect(
        screen.getByRole("dialog").querySelector("img")?.getAttribute("src"),
      ).toBe("/api/events/p-ev/photos/ph-mid/image");
    });

    it("←→ で前後の写真にたどれる", () => {
      renderTimeline([ev({ id: "p-ev", title: "写真のある回" })], {
        eventPhotos: photos,
      });
      fireEvent.click(screen.getByLabelText("写真1枚目を拡大表示"));
      const src = () =>
        screen.getByRole("dialog").querySelector("img")?.getAttribute("src");
      expect(src()).toBe("/api/events/p-ev/photos/ph-top/image");

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
      expect(src()).toBe("/api/events/p-ev/photos/ph-mid/image");
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
      expect(src()).toBe("/api/events/p-ev/photos/ph-top/image");
      // 先頭からさらに戻ると末尾へ回る
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
      expect(src()).toBe("/api/events/p-ev/photos/ph-low/image");
    });

    it("読み込めなかった写真は壊れた画像を出さず無地の枠にする", () => {
      const { container } = renderTimeline(
        [ev({ id: "p-ev", title: "写真のある回" })],
        { eventPhotos: photos },
      );
      const first = container.querySelectorAll("img")[0];
      fireEvent.error(first);
      const srcs = [...container.querySelectorAll("img")].map((i) =>
        i.getAttribute("src"),
      );
      expect(srcs).not.toContain("/api/events/p-ev/photos/ph-top/image");
      // サムネイルの枠自体は残るので、並び順や押せる場所は変わらない
      expect(screen.getByLabelText("写真1枚目を拡大表示")).toBeTruthy();
    });

    it("写真が無いイベントにはサムネイルを出さない", () => {
      const { container } = renderTimeline([
        ev({ id: "nophoto", title: "写真のない回", imageUpdatedAt: null }),
      ]);
      expect(container.querySelector("img")).toBeNull();
    });
  });

  it("イベント画像が無くてもタイトルが読め、詳細への導線が残る", () => {
    const { container } = renderTimeline([
      ev({ id: "noimg", title: "画像なしイベント" }),
    ]);
    // 画像の代わりに色を敷いてタイトルを載せるので、タイトルは2か所に出る
    expect(screen.getAllByText("画像なしイベント").length).toBe(2);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/events/noimg");
  });

  it("イベント画像があるときはバナーに使われる（遅延読み込み）", () => {
    const { container } = renderTimeline([
      ev({ id: "img", title: "画像ありイベント", imageUpdatedAt: 1234 }),
    ]);
    const banner = container.querySelector("img");
    expect(banner?.getAttribute("src")).toBe("/api/events/img/image?v=1234");
    expect(banner?.getAttribute("loading")).toBe("lazy");
    // 画像があるならタイトルの二重描きはしない
    expect(screen.getAllByText("画像ありイベント").length).toBe(1);
  });

  it("件数が多くても畳まず全部出す（#310 で古い側が隠れていた）", () => {
    const base = new Date("2024-05-03T13:00:00+09:00").getTime();
    const many = Array.from({ length: 25 }, (_, i) =>
      ev({
        id: `e-${i}`,
        title: `過去イベント${i}`,
        startsAt: base - i * 86400_000,
        endsAt: base - i * 86400_000 + 3600_000,
      }),
    );
    renderTimeline(many);
    for (const e of many) expect(screen.getAllByText(e.title).length).toBe(2);
    expect(screen.queryByRole("button", { name: /もっと見る/ })).toBeNull();
  });

  it("1件も無ければ何も描かない", () => {
    const { container } = renderTimeline([]);
    expect(container.textContent).toBe("");
  });
});
