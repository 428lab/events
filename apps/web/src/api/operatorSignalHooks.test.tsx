import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type { EventSignalSource } from "@eventer/shared";

/**
 * Operator screens refetch on their refetch signal instead of a timer (D-POLL-MIN Phase 5b-2):
 * live (/live/screen, /live/control), qa (projector, presenter panel), prize-desk,
 * meet-ranking (projector) and bingo-staff (draw control). The hub is faked: these tests pin
 * which source each hook listens to, that nothing polls, and that a signal refetches.
 */

const { apiGet, listeners, synced } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  listeners: [] as Array<{ source: EventSignalSource | null | undefined; onSignal: () => unknown }>,
  synced: { value: true },
}));
vi.mock("./client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));
vi.mock("../lib/signalHub.js", () => ({
  useEventSignal: (source: EventSignalSource | null | undefined, onSignal: () => unknown) => {
    listeners.push({ source, onSignal });
    return { synced: Boolean(source) && synced.value };
  },
}));

const { useEventLiveState } = await import("./liveControlHooks.js");
const { useEventQa } = await import("./eventQaHooks.js");
const { useMeetPrizeLog, useMeetPrizeStatus } = await import("./meetPrizeHooks.js");
const { useMeetRankingLive } = await import("./eventMeetHooks.js");
const { useBingoStatus } = await import("./bingoHooks.js");

const source = (topic: string): EventSignalSource => ({ kind: EVENT_SIGNAL_KIND, pubkey: "5e".repeat(32), topic, rev: 1, relays: ["wss://relay.example"] });

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const lastListener = () => listeners.at(-1)!;
const callsTo = (path: string) => apiGet.mock.calls.filter(([url]) => url === path).length;

afterEach(() => {
  vi.useRealTimers();
  apiGet.mockReset();
  listeners.length = 0;
  synced.value = true;
});

async function flush(ms = 50) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe("useEventLiveState (topic live)", () => {
  it("does not poll, refetches once per signal, and is current only while fetched OK and synced", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue({ chatSource: "event", cutin: null, signal: source("live") });
    const { result, rerender } = renderHook(() => useEventLiveState("e-1"), { wrapper: wrapper() });
    await flush();
    expect(callsTo("/events/e-1/live-state")).toBe(1);
    expect(lastListener().source).toEqual(source("live"));
    expect(result.current.current).toBe(true);

    await flush(60_000);
    expect(callsTo("/events/e-1/live-state")).toBe(1); // no 1 s / 5 s poll any more

    await act(async () => { await lastListener().onSignal(); });
    expect(callsTo("/events/e-1/live-state")).toBe(2);

    synced.value = false;
    rerender();
    expect(result.current.current).toBe(false); // subscription down: screen fails closed

    synced.value = true;
    rerender();
    expect(result.current.current).toBe(true);
    apiGet.mockRejectedValueOnce(new Error("forbidden(403)"));
    await act(async () => { await lastListener().onSignal(); });
    await flush();
    expect(result.current.isError).toBe(true);
    expect(result.current.current).toBe(false); // failed GET: fails closed even with old data
  });

  it("is never current without a signal source (no service key)", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue({ chatSource: "event", cutin: null, signal: null });
    const { result } = renderHook(() => useEventLiveState("e-1"), { wrapper: wrapper() });
    await flush();
    expect(result.current.data).toBeTruthy();
    expect(result.current.current).toBe(false);
  });
});

describe("useEventQa (topic qa)", () => {
  it("listens only when watched (projector, presenter panel) and never polls", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue({ enabled: true, questions: [], signal: source("qa") });
    renderHook(() => useEventQa("e-1", true), { wrapper: wrapper() });
    await flush(60_000);
    expect(lastListener().source).toBeNull();
    expect(callsTo("/events/e-1/questions")).toBe(1);

    renderHook(() => useEventQa("e-2", true, true), { wrapper: wrapper() });
    await flush(60_000);
    expect(lastListener().source).toEqual(source("qa"));
    expect(callsTo("/events/e-2/questions")).toBe(1);
    await act(async () => { await lastListener().onSignal(); });
    expect(callsTo("/events/e-2/questions")).toBe(2);
  });
});

describe("useMeetPrizeStatus / useMeetPrizeLog (topic prize-desk)", () => {
  it("one prize-desk signal refetches both the status and the redemption log; neither polls", async () => {
    vi.useFakeTimers();
    apiGet.mockImplementation(async (url: string) => url.endsWith("/status")
      ? { prizes: [], winners: [], bingoAchievers: [], signal: source("prize-desk") }
      : { log: [] });
    renderHook(() => { useMeetPrizeStatus("e-1", true, true); useMeetPrizeLog("e-1", true); }, { wrapper: wrapper() });
    await flush(60_000);
    expect(callsTo("/events/e-1/meet-prizes/status")).toBe(1);
    expect(callsTo("/events/e-1/meet-prizes/log")).toBe(1);
    expect(lastListener().source).toEqual(source("prize-desk"));
    await act(async () => { await lastListener().onSignal(); });
    await flush();
    expect(callsTo("/events/e-1/meet-prizes/status")).toBe(2);
    expect(callsTo("/events/e-1/meet-prizes/log")).toBe(2);
  });
});

describe("useMeetRankingLive (topic meet-ranking)", () => {
  it("only the projector listens; the detail card does not; neither polls", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue({ mode: "anonymous", ranking: [], totalRanked: 0, me: null, signal: source("meet-ranking") });
    renderHook(() => useMeetRankingLive("e-1", true), { wrapper: wrapper() });
    await flush(60_000);
    expect(lastListener().source).toBeNull();
    renderHook(() => useMeetRankingLive("e-2", true, true), { wrapper: wrapper() });
    await flush(60_000);
    expect(lastListener().source).toEqual(source("meet-ranking"));
    expect(callsTo("/events/e-1/meets/ranking/live") + callsTo("/events/e-2/meets/ranking/live")).toBe(2);
    await act(async () => { await lastListener().onSignal(); });
    expect(callsTo("/events/e-2/meets/ranking/live")).toBe(2);
  });
});

describe("useBingoStatus (topic bingo-staff)", () => {
  it("does not poll and refetches on the bingo-staff signal", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue({ status: "running", drawnNumbers: [], counts: { cards: 0, bingo: 0, reach: 0 }, rows: [], signal: source("bingo-staff") });
    renderHook(() => useBingoStatus("e-1", true), { wrapper: wrapper() });
    await flush(60_000);
    expect(callsTo("/events/e-1/bingo/status")).toBe(1);
    expect(lastListener().source).toEqual(source("bingo-staff"));
    await act(async () => { await lastListener().onSignal(); });
    expect(callsTo("/events/e-1/bingo/status")).toBe(2);
  });
});
