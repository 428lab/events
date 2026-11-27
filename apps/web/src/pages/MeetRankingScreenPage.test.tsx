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
 * 運営（canReveal）だけ、行を押すたびに 明かす／隠す が切り替わる。投影に写るのでガイドやボタンは出さない */
it("目隠し: 運営は行を押すと明かし、もう1回押すと隠す。ガイドやボタンは出さない", () => {
  const ranking = [
    { rank: 1, count: 3, revealed: false as const },
    { rank: 2, count: 2, revealed: true as const, userId: "u2", username: "hana", name: "はな", avatarUrl: null },
  ];
  live.data = { mode: "blind", ranking, totalRanked: 2, me: null, note: "", canReveal: false };
  const { unmount } = draw();
  expect(screen.getByText("？？？")).toBeTruthy();
  expect(screen.getByText("はな")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "1位の名前を見せる" })).toBeNull();
  expect(screen.queryByRole("button", { name: "2位の名前を隠す" })).toBeNull();
  unmount();

  live.data = { mode: "blind", ranking, totalRanked: 2, me: null, note: "", canReveal: true };
  draw();
  // 画面に出る文字は盤とタイトルだけ（「名前を見せる」などのボタンやヒントは無い）
  expect(screen.queryByText(/目隠し中|全員を見せる|目隠しに戻す/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "1位の名前を見せる" }));
  expect(revealMutate).toHaveBeenLastCalledWith({ action: "rank", rank: 1 });
  fireEvent.click(screen.getByRole("button", { name: "2位の名前を隠す" }));
  expect(revealMutate).toHaveBeenLastCalledWith({ action: "hide", rank: 2 });
});
