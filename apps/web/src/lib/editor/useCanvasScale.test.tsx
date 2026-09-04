import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useCanvasScale } from "./useCanvasScale.js";

/**
 * キャンバスの表示倍率 (#466 で2つのエディタから1か所に寄せた)。
 *
 * 測る対象が後から生える画面（読み込み中の早期 return より後ろに置く作り）では、
 * 最初の1回で ref が null になり倍率が 0 のままになる。0 のままだと呼ぶ側の
 * `scale > 0` の判定で**真っ白なキャンバス**になり、エラーも出ないので気づけない。
 * ready を渡せば生えた時点で測り直すこと（＝この落とし穴を塞げること）を押さえる。
 */

/** observe された回数を数えるだけの差し替え。jsdom には無い */
let observed: number;

beforeEach(() => {
  observed = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {
        observed += 1;
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 配信セット編集と同じ形：読み込みが済むまで測る要素そのものを描かない */
function Probe({ ready }: { ready: boolean }) {
  const { ref } = useCanvasScale(960, ready);
  if (!ready) return <div>読み込み中</div>;
  return <div ref={ref} />;
}

describe("測る相手が後から生える画面", () => {
  it("生える前は測りに行かない", () => {
    render(<Probe ready={false} />);
    expect(observed).toBe(0);
  });

  it("生えた時点で測り直す", () => {
    const { rerender } = render(<Probe ready={false} />);
    rerender(<Probe ready />);
    expect(observed).toBe(1);
  });
});

describe("最初から相手がいる画面", () => {
  it("既定のままで測りに行く（ready を渡さなくてよい）", () => {
    function Always() {
      const { ref } = useCanvasScale(960);
      return <div ref={ref} />;
    }
    render(<Always />);
    expect(observed).toBe(1);
  });

  it("まだ測れていない間の倍率は 0（呼ぶ側はこれで描画を止める）", () => {
    let scale = -1;
    function Peek() {
      const s = useCanvasScale(960);
      scale = s.scale;
      return <div ref={s.ref} />;
    }
    // jsdom には寸法が無いので clientWidth は 0 のまま
    render(<Peek />);
    expect(scale).toBe(0);
  });
});
