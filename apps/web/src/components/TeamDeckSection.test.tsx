import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.js";
import { TeamDeckSection } from "./TeamDeckSection.js";

/** チームのスライド (docs/team-participation.md「チームのスライド」) */
const idle = () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null as unknown });
const mock = vi.hoisted(() => ({
  decks: undefined as unknown[] | undefined,
  create: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
  issue: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
  revoke: { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown },
  navigate: vi.fn(),
}));
vi.mock("../api/deckHooks.js", () => ({
  useEventTeamDecks: () => ({ data: mock.decks }),
  useCreateTeamDeck: () => mock.create,
  useIssueTeamDeckAgentToken: () => mock.issue,
  useRevokeTeamDeckAgentToken: () => mock.revoke,
}));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => mock.navigate }));

const draw = () => render(<MemoryRouter><TeamDeckSection eventId="e" teamId="red" /></MemoryRouter>);

beforeEach(() => {
  mock.decks = [];
  mock.create = idle();
  mock.issue = idle();
  mock.revoke = idle();
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

it("AIに書いてもらうと指示文が出る。書いている間は「編集する」を出さず、取り消しボタンを出す", () => {
  mock.decks = [{ entryId: "red", deck: { id: "d1", slug: "abc", title: "赤チーム", updatedAt: 0 }, canEdit: true, agent: null }];
  const view = draw();
  fireEvent.click(screen.getByRole("button", { name: "AIに書いてもらう" }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("メンバーみんな編集できません"));
  const { onSuccess } = mock.issue.mutate.mock.calls[0]![1] as { onSuccess: (res: unknown) => void };
  // サーバーが AI を受け付けたあとの一覧
  mock.decks = [{ entryId: "red", deck: { id: "d1", slug: "abc", title: "赤チーム", updatedAt: 0 }, canEdit: false,
    agent: { expiresAt: Date.now() + 30 * 60_000, issuedBy: { id: "u1", name: "あおい" } } }];
  onSuccess({ token: "evd_x", specUrl: "https://x/deck-import/agent.md", deckId: "d1", expiresAt: Date.now() + 3600_000 });
  view.rerender(<MemoryRouter><TeamDeckSection eventId="e" teamId="red" /></MemoryRouter>);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("evd_x");
  expect(screen.getByText(/AIが書いています（あおいさんが発行/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "編集する" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "AIのアクセスを取り消して編集する" }));
  expect(mock.revoke.mutate).toHaveBeenCalledWith("red", expect.anything());
});

it("ほかのメンバーが頼んでいれば理由を出す", () => {
  mock.issue = { ...idle(), isError: true, error: new ApiError(409, { error: "agent_busy" }) };
  draw();
  expect(screen.getByText(/ほかのメンバーがすでにAIに頼んでいます/)).toBeInTheDocument();
});
