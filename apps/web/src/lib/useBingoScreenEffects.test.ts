import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BingoState } from "@eventer/shared";
import { BINGO_BADGE_MS, BINGO_ROLL_MS, BINGO_SURGE_BIG, useBingoScreenEffects } from "./useBingoScreenEffects.js";

/**
 * ビンゴ投影の演出 (#681 PR1)。どれも前回の応答との差分で起こす:
 * 初回・取り消し（減少）では出さない、ロール中に次が来たら最新で止まる、reduced はロールしない。
 */
const state = (drawn: number[], reach = 0, bingo = 0): BingoState => ({
  gameId: 1,
  status: "running", drawnNumbers: drawn, counts: { cards: 10, bingo, reach }, card: null, me: null,
});

function render(initial: BingoState, reduced = false) {
  return renderHook(({ data, r }) => useBingoScreenEffects(data, r), {
    initialProps: { data: initial, r: reduced },
  });
}
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useBingoScreenEffects", () => {
  it("a new number rolls and lands on the real number", () => {
    const view = render(state([5]));
    view.rerender({ data: state([5, 42]), r: false });
    expect(view.result.current.rolling).toBe(true);
    advance(BINGO_ROLL_MS + 100);
    expect(view.result.current).toMatchObject({ rolling: false, shownNumber: 42, pulseNumber: 42 });
    expect(view.result.current.landKey).toBeGreaterThan(0);
  });

  it("first load, an unchanged refetch and an undo show no effect", () => {
    const view = render(state([5, 42], 3, 1));
    expect(view.result.current).toMatchObject({ rolling: false, shownNumber: 42, landKey: 0, reachBadge: null, bingoBadge: null, surge: null });
    view.rerender({ data: state([5, 42], 3, 1), r: false });
    view.rerender({ data: state([5], 2, 0), r: false });
    expect(view.result.current).toMatchObject({ rolling: false, shownNumber: 5, landKey: 0, reachBadge: null, bingoBadge: null, surge: null });
  });

  it("reduced motion swaps the number immediately without a roll", () => {
    const view = render(state([5]), true);
    view.rerender({ data: state([5, 42]), r: true });
    expect(view.result.current).toMatchObject({ rolling: false, shownNumber: 42 });
    expect(view.result.current.landKey).toBeGreaterThan(0);
  });

  it("a number arriving mid-roll stops the roll on the latest number", () => {
    const view = render(state([5]));
    view.rerender({ data: state([5, 42]), r: false });
    advance(BINGO_ROLL_MS / 3);
    view.rerender({ data: state([5, 42, 61]), r: false });
    expect(view.result.current).toMatchObject({ rolling: false, shownNumber: 61, pulseNumber: 61 });
    advance(BINGO_ROLL_MS * 2);
    expect(view.result.current.shownNumber).toBe(61);
  });

  it("count increases show +n badges and the reach hype, which then clear", () => {
    const view = render(state([5], 1, 0));
    view.rerender({ data: state([5, 42], 1 + BINGO_SURGE_BIG, 2), r: false });
    expect(view.result.current.reachBadge?.n).toBe(BINGO_SURGE_BIG);
    expect(view.result.current.bingoBadge?.n).toBe(2);
    expect(view.result.current.surge).toMatchObject({ n: BINGO_SURGE_BIG, big: true });
    advance(BINGO_BADGE_MS + 10);
    expect(view.result.current.reachBadge).toBeNull();
    expect(view.result.current.bingoBadge).toBeNull();
  });
});
