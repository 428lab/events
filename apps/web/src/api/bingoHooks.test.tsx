import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND, type BingoState, type EventSignalSource } from "@eventer/shared";

/**
 * 参加者のビンゴ（カード・投影）は定期に取り直さず、topic `bingo` の合図で取り直す
 * （D-POLL-MIN 第5段階 5b-3）。
 *
 * #436 の実機フィードバック（ゲーム作成前に開いた投影が、作成後も更新されない）は、
 * 作成前でも確定メンバーに status "none" と購読先が返ることで守る: 作成の合図で拾う。
 * イベント詳細の小カード（watch なし）は購読しない。
 */

const { apiGet, listeners } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  listeners: [] as Array<{ source: EventSignalSource | null | undefined; onSignal: () => unknown; jitterMs?: number }>,
}));
vi.mock("./client.js", () => ({
  api: { get: apiGet, post: vi.fn(), del: vi.fn(), patch: vi.fn(), put: vi.fn() },
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

const { useBingoState } = await import("./bingoHooks.js");

const source: EventSignalSource = { kind: EVENT_SIGNAL_KIND, pubkey: "5e".repeat(32), topic: "b1".repeat(32), rev: 1, relays: ["wss://relay.example"] };
const state = (status: BingoState["status"]): BingoState => ({
  status, drawnNumbers: [], counts: { cards: 0, bingo: 0, reach: 0 }, card: null, me: null, signal: source,
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
    expect(listeners.at(-1)).toMatchObject({ source, jitterMs: 5_000 }); // participants: spread out

    await flush(60_000);
    expect(apiGet).toHaveBeenCalledTimes(1); // no 10 s poll any more

    await act(async () => { await listeners.at(-1)!.onSignal(); });
    await flush();
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(result.current.data?.status).toBe("setup");
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
