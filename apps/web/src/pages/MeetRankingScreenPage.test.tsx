import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import type { MeetRankingLive } from "@eventer/shared";

/** 出会いランキングの投影に、主催者が書いた説明を文字のまま出す（オーナー依頼 2026-11-25） */
const live: { data: MeetRankingLive } = {
  data: { mode: "named", ranking: [], totalRanked: 0, me: null, note: "" },
};
vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: { event: { id: "e1", title: "交流会", meetRanking: "named" } }, isLoading: false, isError: false }),
}));
vi.mock("../api/eventMeetHooks.js", () => ({ useMeetRankingLive: () => live }));
// ランキングの盤は幅を測る（#683）。jsdom には ResizeObserver が無いので何もしない形で置く
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const { MeetRankingScreenPage } = await import("./MeetRankingScreenPage.js");

const draw = () =>
  render(
    <MemoryRouter initialEntries={["/events/e1/meet-ranking/screen"]}>
      <Routes><Route path="/events/:id/meet-ranking/screen" element={<MeetRankingScreenPage />} /></Routes>
    </MemoryRouter>,
  );

it("説明があれば文字のまま出し（HTML として解釈しない）、空なら出さない", () => {
  live.data = { ...live.data, note: "上位3人に素敵なプレゼント！\n<b>受付</b>で" };
  const { unmount } = draw();
  const note = screen.getByTestId("meet-ranking-note");
  expect(note.textContent).toBe("上位3人に素敵なプレゼント！\n<b>受付</b>で");
  expect(note.querySelector("b")).toBeNull();
  unmount();

  live.data = { ...live.data, note: "" };
  draw();
  expect(screen.queryByTestId("meet-ranking-note")).toBeNull();
});
