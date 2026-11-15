import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BingoState, BingoStatus } from "@eventer/shared";

/**
 * 投影のビンゴのカットイン (#681 PR3・案N1)。名前は staff で開いた投影だけに出る。
 * staff でない投影は名前入りの一覧（/bingo/status）を取りに行かず、人数だけを出す。
 * 合図はここではフェイクにし、届いた BingoState / BingoStatus をキャッシュに書いて差分を起こす。
 */
const mocks = vi.hoisted(() => ({ get: vi.fn(), role: "staff" as "staff" | "participant" }));
vi.mock("../api/client.js", () => ({
  api: { get: mocks.get, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));
vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: { event: { id: "e1", title: "ビンゴ大会" }, myRole: mocks.role }, isLoading: false, isError: false }),
  useIsAdmin: () => false,
}));
vi.mock("../lib/signalHub.js", () => ({
  PARTICIPANT_SIGNAL_JITTER_MS: 5_000,
  useEventSignal: () => ({ synced: true }),
}));
const sound = vi.hoisted(() => ({ unlock: vi.fn(async () => undefined) }));
vi.mock("../lib/effects.js", () => ({
  playBingoRoll: vi.fn(async () => true),
  playBingoLand: vi.fn(async () => true),
  playFanfare: vi.fn(async () => true),
  stopBingoRoll: vi.fn(),
  unlockBingoSound: sound.unlock,
}));
const { EventBingoScreenPage } = await import("./EventBingoScreenPage.js");

const bingoState = (bingo: number): BingoState => ({
  gameId: 1, status: "running", drawnNumbers: [1, 2, 3], counts: { cards: 5, bingo, reach: 0 }, card: null, me: null,
});
const row = (userId: string, name: string, bingo: boolean) => ({
  userId, username: userId, name, avatarUrl: null, bingo, reach: false, completedAtSeq: bingo ? 3 : null, rank: bingo ? 1 : null,
});
const bingoStatus = (rows: ReturnType<typeof row>[]): BingoStatus => ({
  status: "running", drawnNumbers: [1, 2, 3], counts: { cards: 5, bingo: rows.filter((r) => r.bingo).length, reach: 0 }, rows,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/events/e1/bingo/screen"]}>
    <Routes><Route path="/events/:id/bingo/screen" element={<EventBingoScreenPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  return qc;
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/bingo/status")) return bingoStatus([row("u1", "あおい", false)]);
    if (path.endsWith("/bingo")) return bingoState(0);
    throw new Error(path);
  });
});
afterEach(() => { mocks.role = "staff"; });

it("staff projector: the cut-in shows the new winner's name once the staff list arrives", async () => {
  mocks.role = "staff";
  const qc = renderPage();
  await screen.findByText("ビンゴ大会");
  await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/events/e1/bingo/status"));
  await act(async () => { qc.setQueryData(["event", "e1", "bingo"], bingoState(1)); });
  expect(await screen.findByTestId("bingo-cutin")).toHaveTextContent("1人目");
  await act(async () => { qc.setQueryData(["event", "e1", "bingo-status"], bingoStatus([row("u1", "あおい", true)])); });
  expect(await screen.findByTestId("bingo-cutin-names")).toHaveTextContent("あおい");
});

it("participant projector: count only, and the staff list is never requested", async () => {
  mocks.role = "participant";
  const qc = renderPage();
  await screen.findByText("ビンゴ大会");
  await act(async () => { qc.setQueryData(["event", "e1", "bingo"], bingoState(2)); });
  expect(await screen.findByTestId("bingo-cutin")).toHaveTextContent("2人同時");
  expect(screen.queryByTestId("bingo-cutin-names")).toBeNull();
  expect(screen.queryByText("あおい")).toBeNull();
  expect(mocks.get).not.toHaveBeenCalledWith("/events/e1/bingo/status");
});

it("sound is off by default; the toggle unlocks audio and is remembered. The participant card page has no sound", async () => {
  localStorage.removeItem("eventer:bingoScreenSound");
  renderPage();
  await screen.findByText("ビンゴ大会");
  const toggle = screen.getByRole("button", { name: "音を出す" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(sound.unlock).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "音を消す" })).toHaveAttribute("aria-pressed", "true");
  expect(localStorage.getItem("eventer:bingoScreenSound")).toBe("1");
  // 参加者のスマホでは鳴らさない（会場で一斉に鳴るのを防ぐ）
  const participantPage = (await import("./EventBingoPage.tsx?raw")).default;
  expect(participantPage).not.toMatch(/effects\.js|useBingoScreenSound|new Audio|AudioContext/);
});
