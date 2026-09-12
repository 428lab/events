import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Event } from "@eventer/shared";
import { EventCard } from "./EventCard.js";

/** グリッド表示（compact）のカードに参加人数が出ること。
 * 日時と同じ行に詰めていた頃は noWrap で人数側が切れて見えなかった。 */
function ev(over: Partial<Event> = {}): Event {
  return {
    id: "e-1",
    title: "テストイベント",
    subtitle: "",
    description: "",
    status: "published",
    scheduling: false,
    startsAt: new Date("2026-08-09T13:00:00+09:00").getTime(),
    endsAt: new Date("2026-08-09T21:00:00+09:00").getTime(),
    venueType: "offline",
    attendanceCheck: false,
    participantCount: 5,
    attendedCount: 0,
    capacityTotal: null,
    imageUrl: null,
    ...over,
  } as Event;
}

function renderCard(event: Event, variant: "list" | "compact" | "grid" = "grid") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventCard event={event} variant={variant} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("グリッド表示のカード", () => {
  it("参加人数が出る", () => {
    renderCard(ev());
    expect(screen.getByText(/参加 5 人/)).toBeTruthy();
  });

  it("人数が日時と同じ要素に詰め込まれていない（切れて消えない）", () => {
    renderCard(ev());
    const count = screen.getByText(/参加 5 人/);
    // 同じ要素に日時が入っていると、noWrap で人数側が省略される
    expect(count.textContent).not.toMatch(/13:00/);
  });

  it("日程調整中でも人数が出る", () => {
    renderCard(ev({ scheduling: true, startsAt: 0, endsAt: 0 }));
    expect(screen.getByText("日程調整中")).toBeTruthy();
    expect(screen.getByText(/参加 5 人/)).toBeTruthy();
  });
});

/** リスト（従来）とコンパクトの違い (#488)。
 * 横並びの固定は、指定そのものを見て確かめる。jsdom は @media を解決しないので
 * 幅で検証できず、`{ xs: "column", sm: "row" }` のような指定は base の値が空になる。
 * その性質を使って「compact は素の row」「list は breakpoint 付き（＝狭い画面で
 * 縦積みに戻る）」を区別している。書き方だけ変えるときはこのテストも直すこと。 */
const flexDirectionOf = (container: HTMLElement) =>
  getComputedStyle(container.querySelector("a.MuiCardActionArea-root")!).flexDirection;

describe("リスト表示（従来・既定）のカード (#488)", () => {
  it("既定は list（variant 省略）で、狭い画面では縦積み＝素の row ではない", () => {
    const { container } = renderCard(ev(), "list");
    expect(flexDirectionOf(container)).not.toBe("row");
  });

  it("タイトルと日時が出る", () => {
    renderCard(ev(), "list");
    // 画像なしイベントはサムネ面にもタイトルを敷くので、ちょうど 2 か所
    expect(screen.getAllByText("テストイベント")).toHaveLength(2);
    expect(screen.getByText(/13:00/)).toBeTruthy();
  });
});

describe("コンパクト表示のカード (#488)", () => {
  it("幅を問わず横並び", () => {
    const { container } = renderCard(ev(), "compact");
    expect(flexDirectionOf(container)).toBe("row");
  });

  it("タイトル・日時・人数が出る", () => {
    renderCard(ev(), "compact");
    expect(screen.getAllByText("テストイベント")).toHaveLength(2);
    expect(screen.getByText(/13:00/)).toBeTruthy();
    expect(screen.getByText(/参加 5 人/)).toBeTruthy();
  });

  it("日程調整中はその旨が出る", () => {
    renderCard(ev({ scheduling: true, startsAt: 0, endsAt: 0 }), "compact");
    expect(screen.getByText(/日程調整中/)).toBeTruthy();
  });
});
