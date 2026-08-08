import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MyEventSummary } from "@eventer/shared";
import { ParticipationTimeline } from "./ParticipationTimeline.js";

/**
 * 参加履歴の年表 (#308)。
 *
 * 「どのイベントに行ったか」が一目で追えることが目的なので、
 * 予定が上に来ること・年で区切られること・関わり方が添うこと・
 * 画像が無いイベントでもタイトルが読めることを確かめる。
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
  speakerEventIds: string[] = [],
) {
  return render(
    <MemoryRouter>
      <ParticipationTimeline
        events={events}
        userId={ME}
        speakerEventIds={speakerEventIds}
        now={NOW}
      />
    </MemoryRouter>,
  );
}

describe("参加履歴の年表", () => {
  it("参加予定が先頭にまとまり、過去は年で区切られて新しい順に並ぶ", () => {
    const { container } = renderTimeline([
      ev({ id: "past-2024", title: "2024年のイベント" }),
      ev({
        id: "past-2025",
        title: "2025年のイベント",
        startsAt: new Date("2025-11-01T10:00:00+09:00").getTime(),
        endsAt: new Date("2025-11-01T18:00:00+09:00").getTime(),
      }),
      ev({
        id: "future",
        title: "これから行くイベント",
        startsAt: new Date("2026-10-01T10:00:00+09:00").getTime(),
        endsAt: new Date("2026-10-01T18:00:00+09:00").getTime(),
      }),
    ]);

    // 見出しとタイトルを DOM 順にたどると 予定 → 新しい年 → 古い年 の順になる
    const text = container.textContent ?? "";
    const positions = [
      "参加予定",
      "これから行くイベント",
      "2025年",
      "2025年のイベント",
      "2024年",
      "2024年のイベント",
    ].map((s) => text.indexOf(s));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("日程調整中は日付の代わりに調整中と出て、予定の側に入る", () => {
    renderTimeline([
      ev({
        id: "sched",
        title: "日程調整中のイベント",
        scheduling: true,
        startsAt: 0,
        endsAt: 0,
      }),
    ]);
    expect(screen.getByText("参加予定")).toBeTruthy();
    expect(screen.getByText("調整中")).toBeTruthy();
  });

  it("日付が左に出る（年は見出しに任せて月日だけ）", () => {
    renderTimeline([ev({ id: "d", title: "日付のイベント" })]);
    expect(screen.getByText("5/3")).toBeTruthy();
  });

  it("関わり方が添う（主催・スタッフ・審査員・登壇）。ただの参加者には付かない", () => {
    renderTimeline(
      [
        ev({ id: "own", title: "自分が立てた回", myRole: "staff", createdBy: ME }),
        ev({ id: "help", title: "手伝った回", myRole: "staff" }),
        ev({ id: "judge", title: "審査した回", myRole: "judge" }),
        ev({ id: "talk", title: "話した回" }),
        ev({ id: "plain", title: "参加しただけの回" }),
      ],
      ["talk"],
    );
    expect(screen.getByText("主催")).toBeTruthy();
    expect(screen.getByText("スタッフ")).toBeTruthy();
    expect(screen.getByText("審査員")).toBeTruthy();
    expect(screen.getByText("登壇")).toBeTruthy();
    // 参加者だけの回には余計なラベルを足さない
    expect(screen.queryByText("参加者")).toBeNull();
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

  it("イベント画像があるときはサムネイルに使われる（遅延読み込み）", () => {
    const { container } = renderTimeline([
      ev({ id: "img", title: "画像ありイベント", imageUpdatedAt: 1234 }),
    ]);
    const thumb = container.querySelector("img");
    expect(thumb?.getAttribute("src")).toBe("/api/events/img/image?v=1234");
    expect(thumb?.getAttribute("loading")).toBe("lazy");
    // 画像があるならタイトルの二重描きはしない
    expect(screen.getAllByText("画像ありイベント").length).toBe(1);
  });

  it("件数が多いときは古い側を畳み、もっと見るで全部出る", () => {
    const base = new Date("2024-05-03T13:00:00+09:00").getTime();
    const many = Array.from({ length: 25 }, (_, i) =>
      ev({
        id: `e-${i}`,
        title: `過去イベント${i}`,
        imageUpdatedAt: 1,
        startsAt: base - i * 86400_000,
        endsAt: base - i * 86400_000 + 3600_000,
      }),
    );
    renderTimeline(many);

    expect(screen.getByText("過去イベント19")).toBeTruthy();
    expect(screen.queryByText("過去イベント20")).toBeNull();
    // 全体の件数は畳んでいても正しく出す
    expect(screen.getByText("参加の記録（25）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /もっと見る/ }));
    expect(screen.getByText("過去イベント24")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /もっと見る/ })).toBeNull();
  });

  it("参加予定は件数が多くても畳まない", () => {
    const upcoming = Array.from({ length: 22 }, (_, i) =>
      ev({
        id: `f-${i}`,
        title: `予定イベント${i}`,
        imageUpdatedAt: 1,
        startsAt: NOW + (i + 1) * 86400_000,
        endsAt: NOW + (i + 1) * 86400_000 + 3600_000,
      }),
    );
    renderTimeline(upcoming);
    for (const e of upcoming) expect(screen.getByText(e.title)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /もっと見る/ })).toBeNull();
  });

  it("1件も無ければ何も描かない", () => {
    const { container } = renderTimeline([]);
    expect(container.textContent).toBe("");
  });
});
