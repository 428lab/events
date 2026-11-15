import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BingoCutin } from "./useBingoScreenEffects.js";

/**
 * ビンゴの投影の音 (#681 PR4)。演出の変わり目（ロール開始・止まる・カットイン）だけで鳴らし、
 * オフ（既定）のときは何も鳴らさない。自動再生のブロックは案内を出し、次のクリックで取り直す。
 */
const sound = vi.hoisted(() => ({
  roll: vi.fn(async () => true),
  land: vi.fn(async () => true),
  fanfare: vi.fn(async () => true),
  stop: vi.fn(),
  unlock: vi.fn(async () => undefined),
}));
vi.mock("./effects.js", () => ({
  playBingoRoll: sound.roll,
  playBingoLand: sound.land,
  playFanfare: sound.fanfare,
  stopBingoRoll: sound.stop,
  unlockBingoSound: sound.unlock,
}));
const { useBingoScreenSound } = await import("./useBingoScreenSound.js");

type Fx = { rolling: boolean; landKey: number; cutin: BingoCutin | null };
const idle: Fx = { rolling: false, landKey: 0, cutin: null };
const cutin = (key: number): BingoCutin => ({ n: 1, total: 1, key, at: 0 });
/** 1回の抽選とビンゴ: ロール開始 → 止まる → カットイン */
function drawAndBingo(rerender: (p: { fx: Fx }) => void) {
  rerender({ fx: { rolling: true, landKey: 0, cutin: null } });
  rerender({ fx: { rolling: false, landKey: 1, cutin: null } });
  rerender({ fx: { rolling: false, landKey: 1, cutin: cutin(2) } });
}

beforeEach(() => {
  Object.values(sound).forEach((f) => f.mockClear());
  sound.roll.mockImplementation(async () => true);
});
afterEach(() => vi.restoreAllMocks());

it("off (the default): a draw and a bingo play nothing", () => {
  const { rerender } = renderHook(({ fx }) => useBingoScreenSound(fx, false), { initialProps: { fx: idle } });
  drawAndBingo(rerender);
  expect(sound.roll).not.toHaveBeenCalled();
  expect(sound.land).not.toHaveBeenCalled();
  expect(sound.fanfare).not.toHaveBeenCalled();
});

it("on: the roll plays the drum, landing stops it with a blip, the bingo cut-in plays the fanfare, each once", () => {
  const { rerender } = renderHook(({ fx }) => useBingoScreenSound(fx, true), { initialProps: { fx: idle } });
  drawAndBingo(rerender);
  rerender({ fx: { rolling: false, landKey: 1, cutin: cutin(2) } }); // an unrelated re-render does not replay
  expect(sound.roll).toHaveBeenCalledOnce();
  expect(sound.land).toHaveBeenCalledOnce();
  expect(sound.stop).toHaveBeenCalled();
  expect(sound.fanfare).toHaveBeenCalledOnce();
});

it("a blocked play shows the hint; the next click unlocks once and clears it", async () => {
  sound.roll.mockImplementation(async () => false);
  const { result, rerender } = renderHook(({ fx }) => useBingoScreenSound(fx, true), { initialProps: { fx: idle } });
  await act(async () => { rerender({ fx: { rolling: true, landKey: 0, cutin: null } }); });
  expect(result.current.blocked).toBe(true);
  await act(async () => { window.dispatchEvent(new MouseEvent("click")); });
  expect(sound.unlock).toHaveBeenCalledOnce();
  expect(result.current.blocked).toBe(false);
});
