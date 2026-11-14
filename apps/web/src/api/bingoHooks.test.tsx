import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND, type BingoState, type EventSignalSource } from "@eventer/shared";

/**
 * 参加者のビンゴ（カード・投影）は定期に取り直さない。topic `bingo` の合図は番号・人数・状態を
 * 運び、同じゲームならその場で反映する（取り直さない。オーナー決定 2026-11-14）。
 * ゲームが替わったとき（作成・リセット後の開始など）は取り直す。
 *
 * #436 の実機フィードバック（ゲーム作成前に開いた投影が、作成後も更新されない）は、
 * 作成前でも確定メンバーに status "none" と購読先が返ることで守る: 作成の合図で拾う。
 * イベント詳細の小カード（watch なし）は購読しない。
 */

const { apiGet, listeners } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  listeners: [] as Array<{ source: EventSignalSource | null | undefined; onSignal: (content: Record<string, unknown> & { rev: number }) => unknown; jitterMs?: number }>,
}));
vi.mock("./client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
  NetworkError: class NetworkError extends Error {},
}));
vi.mock("../lib/signalHub.js", () => ({
  PARTICIPANT_SIGNAL_JITTER_MS: 5_000,
  useEventSignal: (source: EventSignalSource | null | undefined, onSignal: (content: Record<string, unknown> & { rev: number }) => unknown, options: { jitterMs?: number } = {}) => {
    listeners.push({ source, onSignal, jitterMs: options.jitterMs });
    return { synced: Boolean(source) };
  },
}));

const { useBingoState } = await import("./bingoHooks.js");

const source: EventSignalSource = { kind: EVENT_SIGNAL_KIND, pubkey: "5e".repeat(32), topic: "b1".repeat(32), rev: 1, relays: ["wss://relay.example"] };
const state = (status: BingoState["status"], gameId: number | null = null): BingoState => ({
  gameId, status, drawnNumbers: [], counts: { cards: 0, bingo: 0, reach: 0 }, card: null, me: null, signal: source,
});
/** Card whose first row (B column 1–5 in card order) completes after 1..5 are drawn */
const CARD = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65];
const signal = (rev: number, gameId: number | null, drawnNumbers: number[], status = "running") => ({
  rev, gameId, status, drawnNumbers, counts: { cards: 2, bingo: 0, reach: 1 },
});

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
async function flush(ms = 50) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

afterEach(() => {
  vi.useRealTimers();
  apiGet.mockReset();
  listeners.length = 0;
});

describe("useBingoState (topic bingo)", () => {
  it("does not poll; a page opened before the game exists picks it up on the create signal (#436)", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValueOnce(state("none")).mockResolvedValue(state("setup"));
    const { result } = renderHook(() => useBingoState("e-1", true, true), { wrapper: wrapper() });
    await flush();
    expect(result.current.data?.status).toBe("none");
    expect(listeners.at(-1)).toMatchObject({ source }); // data is applied at once; only refetches are spread

    await flush(60_000);
    expect(apiGet).toHaveBeenCalledTimes(1); // no 10 s poll any more

    // a "none" page cannot apply data: the create signal makes it refetch (spread out)
    await act(async () => { await listeners.at(-1)!.onSignal({ rev: 2, gameId: null, status: "setup", drawnNumbers: [], counts: { cards: 0, bingo: 0, reach: 0 } }); });
    await flush(5_000);
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(result.current.data?.status).toBe("setup");
  });

  it("applies a same-game signal at once without a GET: numbers, counts and my reach from my card", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue({ ...state("running", 100), card: CARD, me: { bingo: false, reach: false, rank: null } });
    const { result } = renderHook(() => useBingoState("e-1", true, true), { wrapper: wrapper() });
    await flush();
    await act(async () => { await listeners.at(-1)!.onSignal(signal(5, 100, [1, 2, 3, 4])); });
    await flush(0); // react-query notifies on a timer
    expect(result.current.data).toMatchObject({ drawnNumbers: [1, 2, 3, 4], counts: { cards: 2, reach: 1 }, me: { reach: true, bingo: false } });
    await flush(10_000);
    expect(apiGet).toHaveBeenCalledTimes(1);
    // an older signal arriving late is ignored
    await act(async () => { await listeners.at(-1)!.onSignal(signal(4, 100, [1])); });
    await flush(0);
    expect(result.current.data?.drawnNumbers).toEqual([1, 2, 3, 4]);
  });

  it("a signal for another game (reset and restart) refetches instead of applying", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValueOnce({ ...state("running", 100), card: CARD, me: { bingo: false, reach: false, rank: null } })
      .mockResolvedValue({ ...state("running", 200), drawnNumbers: [9], card: [9], me: { bingo: false, reach: false, rank: null } });
    const { result } = renderHook(() => useBingoState("e-1", true, true), { wrapper: wrapper() });
    await flush();
    await act(async () => { await listeners.at(-1)!.onSignal(signal(5, 200, [9])); });
    await flush(0);
    expect(result.current.data?.gameId).toBe(100); // not applied onto the old game's card
    await flush(5_000);
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(result.current.data).toMatchObject({ gameId: 200, card: [9] });
  });

  it("the event detail card (no watch) does not subscribe", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(state("running"));
    renderHook(() => useBingoState("e-1", true), { wrapper: wrapper() });
    await flush(60_000);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(listeners.every((l) => l.source == null)).toBe(true);
  });
});
