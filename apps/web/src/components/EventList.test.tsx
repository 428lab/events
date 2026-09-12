import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Event } from "@eventer/shared";
import { EventList, GRID_COLUMNS, ListColumnsToggle } from "./EventList.js";

function ev(i: number): Event {
  return {
    id: `e-${i}`,
    title: `イベント${i}`,
    subtitle: "",
    description: "",
    status: "published",
    scheduling: false,
    startsAt: new Date("2026-08-09T13:00:00+09:00").getTime(),
    endsAt: new Date("2026-08-09T21:00:00+09:00").getTime(),
    venueType: "offline",
    attendanceCheck: false,
    participantCount: 1,
    attendedCount: 0,
    capacityTotal: null,
    imageUrl: null,
  } as unknown as Event;
}

function renderList(view?: string) {
  if (view) localStorage.setItem("eventer:listView", view);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ListColumnsToggle />
        <EventList events={[ev(1), ev(2), ev(3)]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 一覧の見せ方の切替 (#488)。既定は従来のリスト表示 */
describe("EventList の表示モード", () => {
  beforeEach(() => localStorage.clear());

  it("既定は従来のリスト表示", () => {
    renderList();
    expect(screen.getByTestId("event-list-list")).toBeTruthy();
    expect(screen.queryByTestId("event-list-compact")).toBeNull();
    expect(screen.queryByTestId("event-list-grid")).toBeNull();
  });

  it("切替は3択で、それぞれに名前がある", () => {
    renderList();
    expect(screen.getByLabelText("リスト表示")).toBeTruthy();
    expect(screen.getByLabelText("コンパクト表示")).toBeTruthy();
    expect(screen.getByLabelText("グリッド表示")).toBeTruthy();
  });

  it("コンパクトを選ぶと横並びのカードになり、選択が保存される", () => {
    renderList();
    fireEvent.click(screen.getByLabelText("コンパクト表示"));
    expect(screen.getByTestId("event-list-compact")).toBeTruthy();
    expect(localStorage.getItem("eventer:listView")).toBe("compact");
  });

  it("グリッドを選ぶとタイルになり、列数は箱の幅で 2〜3 列に収まる指定", () => {
    renderList();
    fireEvent.click(screen.getByLabelText("グリッド表示"));
    const grid = screen.getByTestId("event-list-grid");
    // jsdom は grid を解決しないので、指定そのものを見る
    expect(getComputedStyle(grid).gridTemplateColumns).toBe(GRID_COLUMNS);
    expect(GRID_COLUMNS).toContain("max(150px");
    expect(GRID_COLUMNS).toContain("/ 3)");
  });

  it("保存された選択で開き直すとその表示になる", () => {
    renderList("grid");
    expect(screen.getByTestId("event-list-grid")).toBeTruthy();
  });

  it("従来に戻せる", () => {
    renderList("compact");
    fireEvent.click(screen.getByLabelText("リスト表示"));
    expect(screen.getByTestId("event-list-list")).toBeTruthy();
    expect(localStorage.getItem("eventer:listView")).toBe("list");
  });

  it("どのモードでも全件出る", () => {
    for (const v of ["list", "compact", "grid"]) {
      localStorage.clear();
      const { unmount } = renderList(v);
      expect(screen.getAllByText(/イベント[123]/).length).toBeGreaterThanOrEqual(3);
      unmount();
    }
  });
});
