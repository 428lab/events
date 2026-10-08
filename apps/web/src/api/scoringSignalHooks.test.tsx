import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND, type EventSignalSource, type EventState } from "@eventer/shared";

/**
 * Contest progress refetches on its signal instead of a 10 s timer (D-POLL-MIN Phase 5b-3):
 * `event-state` (every event page of a contest event, and /awards) and `scores` (/control).
 * The hub is faked: these tests pin which source each hook listens to, the jitter, that
 * nothing polls, that a signal refetches, and that an operator's own write keeps the source.
 */

const { apiGet, apiPatch, listeners } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  listeners: [] as Array<{ source: EventSignalSource | null | undefined; onSignal: () => unknown; jitterMs?: number }>,
}));
vi.mock("./client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: apiPatch, put: vi.fn() },
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));
vi.mock("../lib/signalHub.js", () => ({
  PARTICIPANT_SIGNAL_JITTER_MS: 5_000,
  useEventSignal: (source: EventSignalSource | null | undefined, onSignal: () => unknown, options: { jitterMs?: number } = {}) => {
    listeners.push({ source, onSignal, jitterMs: options.jitterMs });
    return { synced: Boolean(source) };
  },
}));

const { useEventState, useEventStateSignal, useScoreProgress, useScoreSummary, useSetMode, AWARDS_SIGNAL_JITTER_MS } = await import("./scoringHooks.js");

const source = (topic: string): EventSignalSource => ({ kind: EVENT_SIGNAL_KIND, pubkey: "5e".repeat(32), topic, rev: 1, relays: ["wss://relay.example"] });
const eventState = (mode: EventState["mode"]): EventState => ({
  eventId: "e-1", mode, presentingEntryId: null, scoringLocked: false, awardsRevealCursor: null, updatedAt: 1, signal: source("state"),
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}
const callsTo = (path: string) => apiGet.mock.calls.filter(([url]) => url === path).length;
async function flush(ms = 50) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

afterEach(() => {
  vi.useRealTimers();
  apiGet.mockReset();
  apiPatch.mockReset();
  listeners.length = 0;
});

function useStateWithSignal(watch: boolean, awards = false) {
  const query = useEventState("e-1");
  useEventStateSignal("e-1", query.data, { watch, awards });
  return query;
}

describe("useEventStateSignal (topic event-state)", () => {
  it("contest pages do not poll; a signal refetches the state once, spread over the participant jitter", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValueOnce(eventState("normal")).mockResolvedValue(eventState("presentation"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useStateWithSignal(true), { wrapper });
    await flush();
    expect(listeners.at(-1)).toMatchObject({ source: source("state"), jitterMs: 5_000 });

    await flush(60_000);
    expect(callsTo("/events/e-1/state")).toBe(1); // no 10 s poll any more

    await act(async () => { await listeners.at(-1)!.onSignal(); });
    await flush();
    expect(callsTo("/events/e-1/state")).toBe(2);
    expect(result.current.data?.mode).toBe("presentation");
  });

  it("the awards page waits at most 1 s so the 3 s drumroll keeps at least 2 s", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(eventState("awards"));
    const { wrapper } = setup();
    renderHook(() => useStateWithSignal(true, true), { wrapper });
    await flush();
    expect(AWARDS_SIGNAL_JITTER_MS).toBe(1_000);
    expect(listeners.at(-1)).toMatchObject({ source: source("state"), jitterMs: AWARDS_SIGNAL_JITTER_MS });
  });

  it("non-contest event pages do not subscribe", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(eventState("normal"));
    const { wrapper } = setup();
    renderHook(() => useStateWithSignal(false), { wrapper });
    await flush();
    expect(listeners.every((l) => l.source == null)).toBe(true);
  });

  it("refetches on tab focus (decision D2), so a signal missed while away is picked up", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(eventState("normal"));
    const { qc, wrapper } = setup();
    renderHook(() => useStateWithSignal(true), { wrapper });
    await flush();
    expect(qc.getQueryCache().find({ queryKey: ["event", "e-1", "state"] })?.options).toMatchObject({ refetchOnWindowFocus: true });
  });

  it("the operator's own mode change keeps the subscription source", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(eventState("normal"));
    apiPatch.mockResolvedValue({ ...eventState("presentation"), signal: undefined });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => ({ state: useStateWithSignal(true), setMode: useSetMode("e-1") }), { wrapper });
    await flush();
    await act(async () => { await result.current.setMode.mutateAsync("presentation"); });
    expect(qc.getQueryData<EventState>(["event", "e-1", "state"])).toMatchObject({ mode: "presentation", signal: source("state") });
    expect(listeners.at(-1)!.source).toEqual(source("state"));
  });
});

describe("useScoreSummary (topic scores)", () => {
  it("/control refetches summary and progress on a signal, never on a timer", async () => {
    vi.useFakeTimers();
    apiGet.mockImplementation(async (path: string) =>
      path.endsWith("/summary") ? { criteria: [], entries: [], signal: source("scores") } : { judges: [] });
    const { wrapper } = setup();
    renderHook(() => { useScoreSummary("e-1", true); useScoreProgress("e-1", true); }, { wrapper });
    await flush();
    expect(listeners.at(-1)).toMatchObject({ source: source("scores") });
    expect(listeners.at(-1)!.jitterMs ?? 0).toBe(0); // staff screens: immediate
    await flush(60_000);
    expect(callsTo("/events/e-1/scores/summary")).toBe(1);
    expect(callsTo("/events/e-1/scores/progress")).toBe(1);

    await act(async () => { await listeners.at(-1)!.onSignal(); });
    await flush();
    expect(callsTo("/events/e-1/scores/summary")).toBe(2);
    expect(callsTo("/events/e-1/scores/progress")).toBe(2);
  });
});
