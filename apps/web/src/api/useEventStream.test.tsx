import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_STREAM_POLL_MS, useEventStream } from "./scoringHooks.js";

/** D-POLL-MIN: 進行状態の取り直しはコンテスト形式だけ・10秒・表示中だけ。
 * 採点の進捗・集計は /control だけ。表示に戻った瞬間に1回取り直す */

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });

function setup(options: { contestMode: boolean; scoring: boolean }) {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  renderHook(() => useEventStream("e-1", options), { wrapper });
  const keys = () => invalidate.mock.calls.map(([filters]) => (filters?.queryKey ?? []).join("/"));
  return { keys };
}

afterEach(() => {
  vi.useRealTimers();
  visibility = "visible";
});

describe("useEventStream (D-POLL-MIN)", () => {
  it("コンテスト形式でなければ何もしない", () => {
    vi.useFakeTimers();
    const { keys } = setup({ contestMode: false, scoring: false });
    act(() => { vi.advanceTimersByTime(EVENT_STREAM_POLL_MS * 3); });
    expect(keys()).toEqual([]);
  });

  it("コンテスト形式は10秒ごとに状態だけ取り直す（進捗・集計は /control 以外では取らない）", () => {
    vi.useFakeTimers();
    const { keys } = setup({ contestMode: true, scoring: false });
    act(() => { vi.advanceTimersByTime(EVENT_STREAM_POLL_MS - 1); });
    expect(keys()).toEqual([]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(keys()).toEqual(["event/e-1/state"]);
  });

  it("/control では進捗・集計も取り直す", () => {
    vi.useFakeTimers();
    const { keys } = setup({ contestMode: true, scoring: true });
    act(() => { vi.advanceTimersByTime(EVENT_STREAM_POLL_MS); });
    expect(keys()).toEqual(["event/e-1/state", "event/e-1/progress", "event/e-1/summary"]);
  });

  it("非表示の間は取り直さず、表示に戻った瞬間に1回取り直す", () => {
    vi.useFakeTimers();
    const { keys } = setup({ contestMode: true, scoring: false });
    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(EVENT_STREAM_POLL_MS * 3);
    });
    expect(keys()).toEqual([]);
    visibility = "visible";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(keys()).toEqual(["event/e-1/state"]);
  });
});
