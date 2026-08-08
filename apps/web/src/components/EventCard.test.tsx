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

function renderCard(event: Event) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EventCard event={event} compact />
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
