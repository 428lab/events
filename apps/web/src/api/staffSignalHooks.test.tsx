import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND, SCHEDULE_EDIT_RENEW_MS, type EventSignalSource } from "@eventer/shared";

/**
 * Staff screens without a timer (D-POLL-MIN Phase 5b-4): the schedule-editing lease
 * (claim on open and on edit at most once per SCHEDULE_EDIT_RENEW_MS, release on close and
 * pagehide, refetch on `schedule-editing`), the broadcast history (`broadcasts`), the
 * staff chat key bundle (no poll at all) and the entry ticket (no auto refresh).
 * The hub is faked: these tests pin which source each hook listens to and that nothing polls.
 */

const { apiGet, apiPost, apiDel, listeners } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDel: vi.fn(),
  listeners: [] as Array<{ source: EventSignalSource | null | undefined; onSignal: () => unknown; jitterMs?: number }>,
}));
vi.mock("./client.js", () => ({
  api: { get: apiGet, post: apiPost, del: apiDel, patch: vi.fn(), put: vi.fn() },
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

const { useHoldScheduleEditing, useScheduleEditingState } = await import("./eventScheduleHooks.js");
const { useEventBroadcasts } = await import("./broadcastHooks.js");
const { useStaffChat } = await import("./staffChatHooks.js");
const { useMyTicket } = await import("./checkinHooks.js");

const source = (topic: string): EventSignalSource => ({ kind: EVENT_SIGNAL_KIND, pubkey: "5e".repeat(32), topic, rev: 1, relays: ["wss://relay.example"] });
const editor = (userId: string) => ({ userId, name: userId, avatarUrl: null, startedAt: 1, expiresAt: 2 });
const EDITING = "/events/e-1/timetable/editing";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}
async function flush(ms = 50) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
const calls = (mock: typeof apiGet, path: string) => mock.mock.calls.filter(([url]) => url === path).length;
const lastSource = () => listeners.filter((l) => l.source).at(-1);

beforeEach(() => {
  vi.useFakeTimers();
  listeners.length = 0;
  apiGet.mockReset();
  apiPost.mockReset();
  apiDel.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("schedule-editing lease (D4)", () => {
  it("claims once on open, renews on an edit only after SCHEDULE_EDIT_RENEW_MS, and never on a timer", async () => {
    apiPost.mockResolvedValue({ editor: editor("me"), version: 3, signal: source("schedule-editing") });
    apiDel.mockResolvedValue({ editor: null, version: 3 });
    const { wrapper } = setup();
    const { result } = renderHook(() => useHoldScheduleEditing("e-1"), { wrapper });
    await flush();
    expect(calls(apiPost, EDITING)).toBe(1);
    expect(lastSource()).toMatchObject({ source: source("schedule-editing"), jitterMs: undefined });

    // No heartbeat: the claim is not repeated however long the editor stays open
    await flush(SCHEDULE_EDIT_RENEW_MS * 3);
    expect(calls(apiPost, EDITING)).toBe(1);

    // An edit right after a claim does not renew; one after the renew interval does (once)
    act(() => result.current.touch("me"));
    await flush();
    expect(calls(apiPost, EDITING)).toBe(2);
    act(() => result.current.touch("me"));
    await flush();
    expect(calls(apiPost, EDITING)).toBe(2);
    await flush(SCHEDULE_EDIT_RENEW_MS);
    act(() => result.current.touch("me"));
    await flush();
    expect(calls(apiPost, EDITING)).toBe(3);
  });

  it("an edit while someone else holds the lease tries to claim it (no takeover, the server decides)", async () => {
    apiPost.mockResolvedValue({ editor: editor("other"), version: 3, signal: source("schedule-editing") });
    apiDel.mockResolvedValue({ editor: editor("other"), version: 3 });
    const { wrapper } = setup();
    const { result } = renderHook(() => useHoldScheduleEditing("e-1"), { wrapper });
    await flush();
    act(() => result.current.touch("me"));
    await flush();
    expect(calls(apiPost, EDITING)).toBe(2);
  });

  it("a signal re-reads the state without claiming; close releases; pagehide releases with keepalive", async () => {
    apiPost.mockResolvedValue({ editor: null, version: 3, signal: source("schedule-editing") });
    apiGet.mockResolvedValue({ editor: editor("other"), version: 4, signal: source("schedule-editing") });
    apiDel.mockResolvedValue({ editor: null, version: 4 });
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchSpy);
    const { wrapper } = setup();
    const { result, unmount } = renderHook(() => useHoldScheduleEditing("e-1"), { wrapper });
    await flush();

    await act(async () => { await lastSource()!.onSignal(); });
    await flush();
    expect(calls(apiGet, EDITING)).toBe(1);
    expect(calls(apiPost, EDITING)).toBe(1);
    expect(result.current.data?.editor?.userId).toBe("other");

    window.dispatchEvent(new Event("pagehide"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/events/e-1/timetable/editing", expect.objectContaining({ method: "DELETE", keepalive: true }));

    unmount();
    expect(calls(apiDel, EDITING)).toBe(1);
  });

  it("the read-only editing state listens to schedule-editing and does not poll", async () => {
    apiGet.mockResolvedValue({ editor: null, version: 3, signal: source("schedule-editing") });
    const { wrapper } = setup();
    renderHook(() => useScheduleEditingState("e-1", true), { wrapper });
    await flush();
    expect(lastSource()).toMatchObject({ source: source("schedule-editing") });
    await flush(30 * 60_000);
    expect(calls(apiGet, EDITING)).toBe(1);
    await act(async () => { await lastSource()!.onSignal(); });
    await flush();
    expect(calls(apiGet, EDITING)).toBe(2);
  });
});

describe("broadcast history", () => {
  it("listens to broadcasts and refetches only on a signal", async () => {
    apiGet.mockResolvedValue({ broadcasts: [], remainingToday: 1, remainingTotal: 1, signal: source("broadcasts") });
    const { wrapper } = setup();
    renderHook(() => useEventBroadcasts("e-1", true), { wrapper });
    await flush();
    expect(lastSource()).toMatchObject({ source: source("broadcasts") });
    await flush(10 * 60_000);
    expect(calls(apiGet, "/events/e-1/broadcasts")).toBe(1);
    await act(async () => { await lastSource()!.onSignal(); });
    await flush();
    expect(calls(apiGet, "/events/e-1/broadcasts")).toBe(2);
  });
});

describe("staff chat key bundle", () => {
  it("is fetched once and never polled", async () => {
    apiGet.mockResolvedValue({ members: [] });
    const { wrapper } = setup();
    renderHook(() => useStaffChat("e-1", true), { wrapper });
    await flush();
    const first = apiGet.mock.calls.length;
    expect(first).toBe(1);
    await flush(10 * 60_000);
    expect(apiGet.mock.calls.length).toBe(first);
  });
});

describe("entry ticket (D5)", () => {
  it("is fetched once on open and never refreshed automatically", async () => {
    apiGet.mockResolvedValue({ token: "t", expiresAt: Date.now() + 180_000 });
    const { wrapper } = setup();
    renderHook(() => useMyTicket("e-1", true), { wrapper });
    await flush();
    await flush(10 * 60_000);
    expect(calls(apiGet, "/events/e-1/my-ticket")).toBe(1);
  });
});
