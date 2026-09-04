import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useAutoSave } from "./useAutoSave.js";

/**
 * 編集画面の自動保存 (#466 で2つのエディタから1か所に寄せた)。
 *
 * 壊れると「打つたびに保存が飛ぶ」か「保存されないまま閉じる」のどちらかになる。
 * どちらも編集中は気づけないので、投げる回数と間合いを押さえる。
 * 読み込み直後に投げないことも大事で、受け取った中身をそのまま書き戻すと
 * 開いただけで更新時刻が変わってしまう。
 */

function Probe({
  ready,
  value,
  onSave,
}: {
  ready: boolean;
  value: string;
  onSave: () => void;
}) {
  useAutoSave({ ready, deps: [value], onSave });
  return null;
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("読み込み直後", () => {
  it("受け取った中身をそのまま書き戻さない", () => {
    const save = vi.fn();
    render(<Probe ready value="A" onSave={save} />);
    advance(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it("読み込みが済むまでは数えないので、済んだ直後の1回も投げない", () => {
    const save = vi.fn();
    const { rerender } = render(
      <Probe ready={false} value="" onSave={save} />,
    );
    advance(2000);
    rerender(<Probe ready value="A" onSave={save} />);
    advance(2000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("変更したあと", () => {
  it("落ち着いてから1回だけ保存する", () => {
    const save = vi.fn();
    const { rerender } = render(<Probe ready value="A" onSave={save} />);
    rerender(<Probe ready value="AB" onSave={save} />);
    advance(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("待っている間は投げない", () => {
    const save = vi.fn();
    const { rerender } = render(<Probe ready value="A" onSave={save} />);
    rerender(<Probe ready value="AB" onSave={save} />);
    advance(700);
    expect(save).not.toHaveBeenCalled();
  });

  it("続けて打っている間はまとまって1回になる", () => {
    const save = vi.fn();
    const { rerender } = render(<Probe ready value="A" onSave={save} />);
    rerender(<Probe ready value="AB" onSave={save} />);
    advance(400);
    rerender(<Probe ready value="ABC" onSave={save} />);
    advance(400);
    rerender(<Probe ready value="ABCD" onSave={save} />);
    advance(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("間を空けた変更はそれぞれ保存される", () => {
    const save = vi.fn();
    const { rerender } = render(<Probe ready value="A" onSave={save} />);
    rerender(<Probe ready value="AB" onSave={save} />);
    advance(2000);
    rerender(<Probe ready value="ABC" onSave={save} />);
    advance(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("保存に使うのは待ち終えた時点の最新の中身", () => {
    const seen: string[] = [];
    const probe = (value: string) => (
      <Probe ready value={value} onSave={() => seen.push(value)} />
    );
    const { rerender } = render(probe("A"));
    rerender(probe("AB"));
    advance(400);
    rerender(probe("ABC"));
    advance(2000);
    expect(seen).toEqual(["ABC"]);
  });
});
