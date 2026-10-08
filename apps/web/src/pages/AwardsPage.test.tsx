import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND, type AwardsView, type EventSignalSource, type EventState } from "@eventer/shared";

/**
 * The awards page follows announcements through the `event-state` signal (D-POLL-MIN Phase 5b
 * D10 folded the separate awards-sync into it). EventLayout owns the subscription
 * (useEventStateSignal); here the hub is faked and the page is wrapped in that hook, so a
 * signal invalidates the state like the real layout does. Signature, author and topic
 * checks live in the hub (signalHub.test.ts).
 */

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), play: vi.fn(), fanfare: vi.fn(), confetti: vi.fn(),
  listeners: [] as Array<{ source: EventSignalSource | null | undefined; onSignal: () => unknown; eventId?: string; jitterMs?: number }>,
}));
vi.mock("../api/client.js", () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock("../api/hooks.js", () => ({
  useEvent: () => ({ data: { event: { id: "e1", accessRevision: 1 }, myRole: "staff" } }),
  useIsAdmin: () => false,
}));
vi.mock("../lib/entryUser.js", () => ({ useEntryUserResolver: () => () => null }));
vi.mock("../lib/effects.js", () => ({ playDrumroll: mocks.play, playFanfare: mocks.fanfare, fireConfetti: mocks.confetti }));
vi.mock("../lib/signalHub.js", () => ({
  PARTICIPANT_SIGNAL_JITTER_MS: 5_000,
  useEventSignal: (source: EventSignalSource | null | undefined, onSignal: () => unknown, options: { eventId?: string; jitterMs?: number } = {}) => {
    mocks.listeners.push({ source, onSignal, ...options });
    return { synced: Boolean(source) };
  },
}));
const { AwardsPage } = await import("./AwardsPage.js");
const { useEventState, useEventStateSignal } = await import("../api/scoringHooks.js");
const source: EventSignalSource = { kind: EVENT_SIGNAL_KIND, pubkey: "5e".repeat(32), topic: "ab".repeat(32), rev: 1, relays: ["wss://test.invalid"] };
/** The part of EventLayout that listens on /awards */
function AwardsWithLayoutSignal() {
  const { data } = useEventState("e1");
  useEventStateSignal("e1", data, { watch: true, awards: true });
  return <AwardsPage />;
}
let state: EventState;
let awards: AwardsView;
let finishDrumroll: () => void;
const result = (name: string, rank: string) => ({ id: name, entryId: name, entryName: name, awardRankId: rank, specialAwardId: null, total: 7, perCriterion: {} });
const listening = () => mocks.listeners.filter((l) => l.source).at(-1);
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const view = render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/events/e1/awards"]}>
    <Routes><Route path="/events/:id/awards" element={<AwardsWithLayoutSignal />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  return { qc, ...view };
}
async function ready() {
  await screen.findByText("まもなく発表します…");
  await waitFor(() => expect(screen.getByRole("button", { name: "次を発表" })).toBeEnabled());
  await waitFor(() => expect(listening()).toBeDefined());
}
async function emit() {
  await act(async () => { await listening()!.onSignal(); });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.listeners.length = 0;
  state = { eventId: "e1", mode: "awards", awardsRevealCursor: 0, presentingEntryId: null, scoringLocked: true, updatedAt: Date.now() };
  awards = { ranks: [
    { id: "r2", eventId: "e1", name: "準優勝", rankOrder: 2, content: null },
    { id: "r1", eventId: "e1", name: "優勝", rankOrder: 1, content: null },
  ], specials: [], criteria: [], results: [] };
  mocks.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/state")) return { ...structuredClone(state), signal: source };
    if (path.endsWith("/awards")) return structuredClone(awards);
    throw new Error(path);
  });
  mocks.post.mockImplementation(async (path: string) => {
    state = { ...state, awardsRevealCursor: path.endsWith("reset") ? 0 : (state.awardsRevealCursor ?? 0) + 1, updatedAt: Date.now() };
    return structuredClone(state);
  });
  mocks.play.mockImplementation((finish: () => void) => { finishDrumroll = finish; return vi.fn(); });
});

it("an open waiting screen refreshes winners on the trusted signal and follows the next announcement without reload", async () => {
  renderPage(); await ready();
  awards.results = [result("Alice", "r2"), result("Bob", "r1")];
  state = { ...state, awardsRevealCursor: 1, updatedAt: Date.now() - 650 };
  await emit();
  await screen.findByText("受賞は…？");
  expect(mocks.play.mock.calls[0][1]).toBeGreaterThanOrEqual(650);
  expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "次を発表" })).toBeDisabled();
  await act(async () => { finishDrumroll(); });
  await screen.findByText("Alice");
  expect(mocks.fanfare).toHaveBeenCalledTimes(1);
  await emit();
  expect(mocks.play).toHaveBeenCalledTimes(1);
  state = { ...state, awardsRevealCursor: 2, updatedAt: Date.now() };
  await emit();
  await screen.findByText("受賞は…？");
  expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  await act(async () => { finishDrumroll(); });
  await screen.findByText("Bob");
  expect(mocks.fanfare).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "発表を最初からに戻す" }));
  await screen.findByText("まもなく発表します…");
});

it("listens on the event-state topic with the 1 s awards jitter, scoped to this event's access reset", async () => {
  const { unmount } = renderPage(); await ready();
  // Forged/foreign signals and the access-reset stop are enforced in the hub (signalHub.test.tsx).
  expect(listening()).toMatchObject({ source, eventId: "e1", jitterMs: 1_000 });
  expect(mocks.get.mock.calls.some(([path]) => String(path).includes("awards-sync"))).toBe(false);
  unmount();
});

it("host mutation cursor changes also refresh results; slow results stay loading after the drumroll", async () => {
  const { qc } = renderPage(); await ready();
  let release: (value: AwardsView) => void;
  const pending = new Promise<AwardsView>(resolve => { release = resolve; });
  mocks.get.mockImplementation(async (path: string) => path.endsWith("/awards") ? pending : structuredClone(state));
  state = { ...state, awardsRevealCursor: 1, updatedAt: Date.now() };
  await act(async () => { qc.setQueryData(["event", "e1", "state"], state); });
  await screen.findByText("受賞は…？");
  await act(async () => finishDrumroll());
  expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  expect(screen.queryByText("該当者なし")).not.toBeInTheDocument();
  await act(async () => release!({ ...awards, results: [result("Late winner", "r2")] }));
  await screen.findByText("Late winner");
  // The host's HTTP response takes the same cursor-change path (without a relay).
  mocks.get.mockResolvedValue({ ...awards, results: [result("Next winner", "r1")] });
  fireEvent.click(screen.getByRole("button", { name: "次を発表" }));
  await screen.findByText("受賞は…？");
  await act(async () => finishDrumroll());
  await screen.findByText("Next winner");
});

it("initial/reloaded state is fetched without a signal and does not replay an announcement", async () => {
  state = { ...state, awardsRevealCursor: 1 };
  awards.results = [result("Already announced", "r2")];
  renderPage();
  await screen.findByText("Already announced");
  expect(mocks.play).not.toHaveBeenCalled();
  expect(mocks.fanfare).not.toHaveBeenCalled();
});

it("failed result refresh offers a retry rather than presenting a stale recipient", async () => {
  const { qc } = renderPage(); await ready();
  mocks.get.mockRejectedValueOnce(new Error("offline"));
  state = { ...state, awardsRevealCursor: 1, updatedAt: Date.now() - 5000 };
  await act(async () => { qc.setQueryData(["event", "e1", "state"], state); });
  await screen.findByText("表彰結果を取得できませんでした。もう一度お試しください。");
  awards.results = [result("Recovered", "r2")];
  fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
  await screen.findByText("Recovered");
});
