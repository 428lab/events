import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventTrack, ScheduleItem } from "@eventer/shared";

/**
 * タイムテーブル画面 (#338)。
 *
 * 広い画面は格子、狭い画面はトラックのタブに落ちること、未割り当て（ネタ出し中）が
 * 参加者向けの並びに混ざらないことを確かめる。未割り当ては staff にしか届かない
 * ので、届いたときの置き場が無いと画面から消えて編集の手がかりを失う。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client.js")>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => getMock(...args) },
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useParams: () => ({ id: "e-1" }) };
});

const { EventTimetablePage } = await import("./EventTimetablePage.js");

const START = new Date("2026-08-11T10:00:00+09:00").getTime();

const TRACKS: EventTrack[] = [
  { id: "tr-a", name: "A（メインホール）", sortOrder: 0 },
  { id: "tr-b", name: "B（小ホール）", sortOrder: 1 },
];

function item(patch: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return {
    eventId: "e-1",
    title: "コマ",
    description: "",
    durationMin: 30,
    startsAt: null,
    speaker: null,
    speakerUserId: null,
    speakerName: "",
    materialUrl: "",
    materialOgImage: "",
    sortOrder: 0,
    placement: "all",
    trackIds: [],
    ...patch,
  };
}

const ITEMS: ScheduleItem[] = [
  item({ id: "it-open", title: "開会", durationMin: 20 }),
  item({ id: "it-a", title: "セッションA", placement: "tracks", trackIds: ["tr-a"] }),
  item({ id: "it-idea", title: "ネタ出し", placement: "unassigned" }),
];

/** 画面幅。jsdom には matchMedia が無いので、ここで答えを決める */
function setWidth(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function draw(items: ScheduleItem[] = ITEMS, scheduling = false) {
  getMock.mockImplementation((path: string) => {
    if (path.endsWith("/timetable")) {
      return Promise.resolve({ items, tracks: TRACKS });
    }
    return Promise.resolve({
      event: { id: "e-1", title: "テスト大会", startsAt: START, scheduling },
      myRole: "staff",
      community: null,
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <EventTimetablePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("EventTimetablePage (#338)", () => {
  beforeEach(() => {
    getMock.mockReset();
  });
  afterEach(() => {
    // @ts-expect-error テストのために生やしたものを片付ける
    delete window.matchMedia;
  });

  it("広い画面では格子を出す", async () => {
    setWidth(true);
    draw();

    expect(await screen.findByRole("table", { name: "タイムテーブル" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("狭い画面ではトラック選択のタブに落とす", async () => {
    setWidth(false);
    draw();

    expect(await screen.findByRole("tab", { name: /A（メインホール）/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("未割り当ては参加者向けの並びに混ぜず、断り書きを添えて別に出す", async () => {
    setWidth(true);
    draw();

    expect(await screen.findByText("ネタ出し")).toBeInTheDocument();
    expect(screen.getByText("参加者には出ません")).toBeInTheDocument();
    // 格子（参加者に見せる並び）には入れない
    const grid = screen.getByRole("table");
    expect(grid.textContent).not.toContain("ネタ出し");
  });

  it("日程調整中でも壊れず、時刻未定として並ぶ", async () => {
    setWidth(true);
    draw(ITEMS, true);

    expect(await screen.findByText("開始時刻が未定")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
