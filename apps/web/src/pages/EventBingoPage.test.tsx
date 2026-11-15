import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import type { BingoState } from "@eventer/shared";

/**
 * 参加者のビンゴ画面 (#681 PR2): ビンゴになった瞬間の全画面の層。主ボタンは景品の案内
 * （/events/:id#prizes）、閉じた後も従来のビンゴの案内（引換券）は残る。完成ラインを強調する。
 */
const bingo = vi.hoisted(() => ({ data: undefined as BingoState | undefined }));
vi.mock("../api/hooks.js", () => ({ useEvent: () => ({ data: { event: { id: "e1", title: "ビンゴ大会" } } }) }));
vi.mock("../api/bingoHooks.js", () => ({
  useBingoState: () => ({ data: bingo.data, isError: false }),
  useIssueBingoCard: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("../components/BingoWithChat.js", () => ({ BingoWithChat: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../components/EventBreadcrumbs.js", () => ({ EventBreadcrumbs: () => null }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useParams: () => ({ id: "e1" }) }));
const { EventBingoPage } = await import("./EventBingoPage.js");

const CARD = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65];
const state = (drawn: number[], me: { reach: boolean; bingo: boolean; rank: number | null }): BingoState => ({
  gameId: 7, status: "running", drawnNumbers: drawn, counts: { cards: 3, bingo: me.bingo ? 1 : 0, reach: 0 }, card: CARD, me,
});

it("a new bingo opens the full-screen layer with the prize link; closing keeps the voucher alert and the lit line", () => {
  bingo.data = state([1, 2, 3, 4], { reach: true, bingo: false, rank: null });
  const view = render(<MemoryRouter><EventBingoPage /></MemoryRouter>);
  expect(screen.queryByRole("dialog")).toBeNull();

  bingo.data = state([1, 2, 3, 4, 5], { reach: false, bingo: true, rank: null });
  view.rerender(<MemoryRouter><EventBingoPage /></MemoryRouter>);
  const layer = screen.getByRole("dialog");
  expect(layer).toHaveTextContent("ビンゴ！");
  expect(screen.getByRole("link", { name: "景品を選びに行く" })).toHaveAttribute("href", "/events/e1#prizes");

  // 順位は取り直しで少し遅れて届く
  bingo.data = state([1, 2, 3, 4, 5], { reach: false, bingo: true, rank: 2 });
  view.rerender(<MemoryRouter><EventBingoPage /></MemoryRouter>);
  expect(screen.getByRole("dialog")).toHaveTextContent("あなたは2番目のビンゴです。");

  act(() => { fireEvent.click(screen.getByRole("button", { name: "カードに戻る" })); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("スタッフのところで好きな景品を1つ選んでください。");
  // B 列（1〜5）の5マスが完成ラインとして光る
  expect(view.container.querySelectorAll("[data-highlight]")).toHaveLength(5);
});
