import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BingoState } from "@eventer/shared";
import {
  BINGO_BINGO_VIBRATION,
  BINGO_REACH_FLASH_MS,
  BINGO_REACH_VIBRATION,
  useBingoCardEffects,
} from "./useBingoCardEffects.js";

/**
 * 参加者のカードの演出 (#681 PR2)。同じゲームの連続する状態の false → true でだけ起こす:
 * 初回・ゲームの切り替え・取り消しでは出さない。reduced はフラッシュ無しで、振動とビンゴの層は出す。
 */
const CARD = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65];
const state = (drawn: number[], me: { reach: boolean; bingo: boolean }, gameId = 1): BingoState => ({
  gameId, status: "running", drawnNumbers: drawn, counts: { cards: 3, bingo: 0, reach: 0 },
  card: CARD, me: { ...me, rank: null },
});
const none = { reach: false, bingo: false };

function render(initial: BingoState, reduced = false) {
  return renderHook(({ data, r }) => useBingoCardEffects(data, r), { initialProps: { data: initial, r: reduced } });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "vibrate", { value: vi.fn(() => true), configurable: true, writable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("useBingoCardEffects", () => {
  it("reach then bingo: flash and short buzz, then the bingo layer and long buzz; new marks pulse", () => {
    const view = render(state([1, 2], none));
    view.rerender({ data: state([1, 2, 3, 4], { reach: true, bingo: false }), r: false });
    expect(view.result.current.reachFlash).not.toBeNull();
    expect(view.result.current.pulseNumbers).toEqual([3, 4]);
    expect(navigator.vibrate).toHaveBeenLastCalledWith(BINGO_REACH_VIBRATION);
    act(() => { vi.advanceTimersByTime(BINGO_REACH_FLASH_MS); });
    expect(view.result.current.reachFlash).toBeNull();
    // still on reach after the next number: no second flash or buzz
    view.rerender({ data: state([1, 2, 3, 4, 70], { reach: true, bingo: false }), r: false });
    expect(view.result.current.reachFlash).toBeNull();
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);

    view.rerender({ data: state([1, 2, 3, 4, 70, 5], { reach: false, bingo: true }), r: false });
    expect(view.result.current.bingoOpen).toBe(true);
    expect(navigator.vibrate).toHaveBeenLastCalledWith(BINGO_BINGO_VIBRATION);
    // 手で閉じるまで残る
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(view.result.current.bingoOpen).toBe(true);
    act(() => view.result.current.closeBingo());
    expect(view.result.current.bingoOpen).toBe(false);
    // the next number keeps me on bingo: the closed layer stays closed, no new buzz
    view.rerender({ data: state([1, 2, 3, 4, 70, 5, 71], { reach: false, bingo: true }), r: false });
    expect(view.result.current.bingoOpen).toBe(false);
    expect(navigator.vibrate).toHaveBeenCalledTimes(2);
  });

  it("already reach/bingo on first load, or a different game, fires nothing", () => {
    const view = render(state([1, 2, 3, 4, 5], { reach: false, bingo: true }));
    expect(view.result.current).toMatchObject({ bingoOpen: false, reachFlash: null, pulseNumbers: [] });
    // reset and restart: a new game that is already bingo for me (opened late) does not fire either
    view.rerender({ data: state([1, 2, 3, 4, 5], { reach: false, bingo: true }, 2), r: false });
    view.rerender({ data: state([16], none, 3), r: false });
    view.rerender({ data: state([16, 1, 2, 3, 4], { reach: true, bingo: false }, 4), r: false });
    expect(view.result.current).toMatchObject({ bingoOpen: false, reachFlash: null, pulseNumbers: [] });
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it("reduced motion: no flash or pulse, but it still buzzes and opens the bingo layer", () => {
    const view = render(state([1, 2], none), true);
    view.rerender({ data: state([1, 2, 3, 4], { reach: true, bingo: false }), r: true });
    expect(view.result.current).toMatchObject({ reachFlash: null, pulseNumbers: [] });
    expect(navigator.vibrate).toHaveBeenCalledWith(BINGO_REACH_VIBRATION);
    view.rerender({ data: state([1, 2, 3, 4, 5], { reach: false, bingo: true }), r: true });
    expect(view.result.current.bingoOpen).toBe(true);
  });

  it("works without navigator.vibrate (iOS Safari)", () => {
    Reflect.deleteProperty(navigator, "vibrate");
    const view = render(state([1, 2, 3, 4], { reach: true, bingo: false }));
    expect(() => view.rerender({ data: state([1, 2, 3, 4, 5], { reach: false, bingo: true }), r: false })).not.toThrow();
    expect(view.result.current.bingoOpen).toBe(true);
  });
});
