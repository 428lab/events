import { fireEvent, render, screen } from "@testing-library/react";
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
const revealMutate = vi.fn();
vi.mock("../api/eventMeetHooks.js", () => ({ useMeetRankingLive: () => live, useMeetReveal: () => ({ mutate: revealMutate, isPending: false }) }));
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

/** 目隠しモード（オーナー依頼 2026-11-27）。明かしていない行は「？？？」、明かした行は名前。
 * 行を押して明かす操作と下の操作は運営（canReveal）にだけ出る */
it("目隠し: 明かしていない行は「？？？」で、運営だけが行を押して明かせる", () => {
  const ranking = [
    { rank: 1, count: 3, revealed: false as const },
    { rank: 2, count: 2, revealed: true as const, userId: "u2", username: "hana", name: "はな", avatarUrl: null },
  ];
  live.data = { mode: "blind", ranking, totalRanked: 2, me: null, note: "", canReveal: false };
  const { unmount } = draw();
  expect(screen.getByText("？？？")).toBeTruthy();
  expect(screen.getByText("はな")).toBeTruthy();
  expect(screen.queryByTestId("meet-reveal-controls")).toBeNull();
  expect(screen.queryByRole("button", { name: "1位の名前を見せる" })).toBeNull();
  unmount();

  live.data = { mode: "blind", ranking, totalRanked: 2, me: null, note: "", canReveal: true };
  draw();
  expect(screen.getByTestId("meet-reveal-controls")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "1位の名前を見せる" }));
  expect(revealMutate).toHaveBeenCalledWith({ action: "rank", rank: 1 });
  // 明かした行（2位）は押せない
  expect(screen.queryByRole("button", { name: "2位の名前を見せる" })).toBeNull();
});
