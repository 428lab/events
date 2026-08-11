import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventTrack, ScheduleItem } from "@eventer/shared";

/**
 * タイムテーブル画面への導線 (#338)。
 *
 * トラックが1本以下のイベントでは格子にする意味がないので出さない。
 * ここが出っぱなしだと、トラックを使っていないイベントでも参加者が
 * 中身の無い画面へ飛ばされる。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

const { EventSchedule } = await import("./EventSchedule.js");

const ITEM: ScheduleItem = {
  id: "it-1",
  eventId: "e-1",
  title: "オープニング",
  description: "",
  durationMin: 20,
  startsAt: null,
  speaker: null,
  speakerUserId: null,
  speakerName: "",
  materialUrl: "",
  materialOgImage: "",
  sortOrder: 0,
  placement: "all",
  trackIds: [],
};

function draw(tracks: EventTrack[]) {
  getMock.mockImplementation((path: string) => {
    if (path.endsWith("/timetable")) {
      return Promise.resolve({ items: [ITEM], tracks });
    }
    return Promise.resolve(null);
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <EventSchedule eventId="e-1" eventStartsAt={null} isStaff={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const track = (id: string, name: string, sortOrder: number): EventTrack => ({
  id,
  name,
  sortOrder,
});

describe("タイムテーブル画面への導線 (#338)", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("トラックが2本以上あるときだけ出す", async () => {
    draw([track("tr-a", "A", 0), track("tr-b", "B", 1)]);

    const link = await screen.findByRole("link", { name: /トラック別に見る/ });
    expect(link).toHaveAttribute("href", "/events/e-1/timetable");
  });

  it("トラックが1本のときは出さない", async () => {
    draw([track("tr-a", "A", 0)]);

    await screen.findByText("オープニング");
    expect(
      screen.queryByRole("link", { name: /トラック別に見る/ }),
    ).not.toBeInTheDocument();
  });

  it("トラックを使っていないイベントでは出さない", async () => {
    draw([]);

    await screen.findByText("オープニング");
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /トラック別に見る/ }),
      ).not.toBeInTheDocument(),
    );
  });
});
