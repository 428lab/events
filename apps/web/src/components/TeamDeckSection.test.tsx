import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import { TeamDeckSection } from "./TeamDeckSection.js";

/** チームのスライド (docs/team-participation.md「チームのスライド」) */
const mock = vi.hoisted(() => ({
  decks: undefined as unknown[] | undefined,
  create: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
  navigate: vi.fn(),
}));
vi.mock("../api/deckHooks.js", () => ({
  useEventTeamDecks: () => ({ data: mock.decks }),
  useCreateTeamDeck: () => mock.create,
}));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => mock.navigate }));

const draw = () => render(<MemoryRouter><TeamDeckSection eventId="e" teamId="red" /></MemoryRouter>);

beforeEach(() => {
  mock.decks = [];
  mock.create = { mutate: vi.fn(), isPending: false, isError: false, error: null };
  mock.navigate.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it("まだ無ければ「チームのスライドを作る」。URLが公開になることを確認してから作り、編集画面へ移る", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "チームのスライドを作る" }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("URLを知る人はログインせず閲覧できます"));
  expect(mock.create.mutate).toHaveBeenCalledWith("red", expect.anything());
  const { onSuccess } = mock.create.mutate.mock.calls[0]![1] as { onSuccess: (res: { deckId: string }) => void };
  onSuccess({ deckId: "d1" });
  expect(mock.navigate).toHaveBeenCalledWith("/decks/d1/edit");
});

it("イベントが終わったら作るボタンは出さない（書き出しだけ。サーバーも event_ended で止める）", () => {
  render(<MemoryRouter><TeamDeckSection eventId="e" teamId="red" ended /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: "チームのスライドを作る" })).toBeNull();
  expect(screen.getByText("まだありません")).toBeTruthy();
});

it("確認でやめれば作らない", () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  draw();
  fireEvent.click(screen.getByRole("button", { name: "チームのスライドを作る" }));
  expect(mock.create.mutate).not.toHaveBeenCalled();
});

it("あれば「編集する」「見る」。ほかのチームのスライドは使わない", () => {
  mock.decks = [
    { entryId: "blue", deck: { id: "d9", slug: "zzz", title: "青", updatedAt: 0 }, canEdit: false },
    { entryId: "red", deck: { id: "d1", slug: "abc", title: "赤チーム", updatedAt: 0 }, canEdit: true },
  ];
  draw();
  expect(screen.getByRole("link", { name: "編集する" })).toHaveAttribute("href", "/decks/d1/edit");
  expect(screen.getByRole("link", { name: "見る" })).toHaveAttribute("href", "/d/abc");
  expect(screen.queryByRole("button", { name: "チームのスライドを作る" })).toBeNull();
});

it("サーバーのエラーを案内する", () => {
  mock.create = { mutate: vi.fn(), isPending: false, isError: true, error: new ApiError(403, { error: "not_this_team_member" }) };
  draw();
  expect(screen.getByText("このチームのメンバーだけがスライドを作れます。")).toBeInTheDocument();
});
