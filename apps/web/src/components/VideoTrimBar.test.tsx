import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VideoTrimBar } from "./VideoTrimBar.js";

/**
 * トリム枠 (#425) の操作の配線。座標計算は jsdom では測れないため、
 * キーボード操作（←→で1秒）で「伸縮は normalizeVideoTrim・移動は
 * moveVideoTrim を通る」ことを確かめる。数値の正規化自体は
 * lib/video/plan.test.ts が固定している。
 */
describe("VideoTrimBar", () => {
  const setup = (value = { startMs: 0, endMs: 60_000 }, totalMs = 90_000) => {
    const onChange = vi.fn();
    render(<VideoTrimBar totalMs={totalMs} value={value} onChange={onChange} />);
    return onChange;
  };

  it("開始つまみ →キー: 開始が1秒進む（伸縮）", () => {
    const onChange = setup();
    fireEvent.keyDown(screen.getByTestId("trim-handle-start"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ startMs: 1_000, endMs: 60_000 });
  });

  it("終了つまみ →キー: 60秒上限なので開始が追従する（超える範囲は作れない）", () => {
    const onChange = setup();
    fireEvent.keyDown(screen.getByTestId("trim-handle-end"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ startMs: 1_000, endMs: 61_000 });
  });

  it("枠 →キー: 長さを保ったまま移動する", () => {
    const onChange = setup({ startMs: 10_000, endMs: 40_000 });
    fireEvent.keyDown(screen.getByTestId("trim-frame"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ startMs: 11_000, endMs: 41_000 });
  });

  it("枠 ←キー: 左端で止まる", () => {
    const onChange = setup({ startMs: 0, endMs: 30_000 });
    fireEvent.keyDown(screen.getByTestId("trim-frame"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ startMs: 0, endMs: 30_000 });
  });
});
