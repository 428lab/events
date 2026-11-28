import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Deck } from "@eventer/shared";
import { ApiError } from "../api/client.js";

/** 作成済みのスライドを AI に直してもらう（docs/agent-deck-token.md §4c。オーナー決定 2026-11-28） */
const mocks = vi.hoisted(() => ({
  deck: null as Deck | null,
  error: null as unknown,
  issue: vi.fn(),
  revoke: vi.fn(),
  undo: vi.fn(),
}));
vi.mock("../api/client.js", async (orig) => {
  const real = await orig<typeof import("../api/client.js")>();
  return { ...real, api: { ...real.api, get: vi.fn(async () => mocks.deck) } };
});
vi.mock("../api/deckHooks.js", () => ({
  useDeck: () => ({ data: mocks.error ? undefined : mocks.deck, isLoading: !mocks.error && mocks.deck === null, isError: Boolean(mocks.error), error: mocks.error }),
  useUpdateDeck: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadDeckImage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUndoDeckAi: () => ({ mutate: mocks.undo, isPending: false, isSuccess: false, isError: false }),
  useIssueEditDeckAgentToken: () => ({ mutate: mocks.issue, isPending: false, isError: false }),
  useRevokeEditDeckAgentToken: () => ({ mutate: mocks.revoke, isPending: false }),
}));
const { DeckEditorPage } = await import("./DeckEditorPage.js");
// jsdom には無いので、幅を測る仕掛けだけ差し替える（測れた幅は 0 のまま）
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
vi.stubGlobal("scrollTo", vi.fn());

const deck = (extra: Partial<Deck> = {}): Deck => ({
  id: "d-1", slug: "abc", ownerId: "u-1", title: "発表", createdAt: 0, updatedAt: 0, revision: 3,
  content: { slides: [{ id: "s1", background: "#ffffff", elements: [] }] }, ...extra,
});
const draw = () => render(<MemoryRouter><DeckEditorPage /></MemoryRouter>);
afterEach(() => { vi.clearAllMocks(); mocks.deck = null; mocks.error = null; mocks.issue.mockReset(); mocks.revoke.mockReset(); mocks.undo.mockReset(); });

it("自分のスライドに「AIに直してもらう」が出て、発行すると AI が書いている案内と指示文に切り替わる", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.deck = deck();
  const view = draw();
  expect(await screen.findByRole("button", { name: "AIに直してもらう" })).toBeTruthy();
  mocks.issue.mockImplementation((_v: unknown, opts: { onSuccess: (r: object) => void }) =>
    opts.onSuccess({ token: "evd_xyz", specUrl: "https://events.example/deck-import/agent.md", deckId: "d-1", expiresAt: Date.now() + 3_600_000 }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AIに直してもらう" })); });
  expect(mocks.issue).toHaveBeenCalledOnce();

  // 発行のあと、編集用の取得は 423（scope: deck）になる
  mocks.error = new ApiError(423, { error: "agent_writing", agent: { expiresAt: Date.now() + 30 * 60_000, issuedBy: null, scope: "deck" } });
  view.rerender(<MemoryRouter><DeckEditorPage /></MemoryRouter>);
  expect(await screen.findByText(/いまAIがこのスライドを直しています/)).toBeTruthy();
  expect((screen.getByRole("textbox", { name: /AIに渡す指示文/ }) as HTMLTextAreaElement).value).toContain("evd_xyz");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "AIのアクセスを取り消して編集する" })); });
  expect(mocks.revoke).toHaveBeenCalledOnce();
});

it("AI が直したあとは「AIの変更を取り消す」が出て、確認のあとで戻す。チームのスライドには発行ボタンが出ない", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.deck = deck({ aiBackupAt: Date.now() - 60_000 });
  const view = draw();
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "AIの変更を取り消す" })); });
  expect(mocks.undo).toHaveBeenCalledOnce();
  view.unmount();

  mocks.deck = deck({ team: { entryId: "t1", eventId: "e1", name: "紫苑" } });
  draw();
  await screen.findByRole("button", { name: /書き出す|Export/ }).catch(() => undefined);
  expect(screen.getByDisplayValue("発表")).toBeTruthy(); // 描けている（読み込みで止まっていない）
  expect(screen.queryByRole("button", { name: "AIに直してもらう" })).toBeNull();
});
