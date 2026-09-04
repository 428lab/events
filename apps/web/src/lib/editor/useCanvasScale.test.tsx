import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useCanvasScale } from "./useCanvasScale.js";

/**
 * キャンバスの表示倍率 (#466 で2つのエディタから1か所に寄せた)。
 *
 * 落とし穴は「測る相手がまだ生えていないのに測りに行く」こと。倍率が 0 のままだと
 * 呼ぶ側の `scale > 0` の判定で**真っ白なキャンバス**になり、エラーも出ないので
 * 気づけない。**部品の中で ref を付けた要素が必ず描かれること**が前提なので、
 * その前提が満たされているとき（マウント時）に確かに測りに行くことを押さえる。
 * 読み込みを待つ画面は、待つ側と測る側を別の部品に分けてこの前提を守る。
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

describe("実測幅から倍率を出す", () => {
  it("マウントした時点で測りに行く", () => {
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

  it("実測幅を基準の幅で割ったものが倍率になる", () => {
    // jsdom の clientWidth は常に 0 なので、幅がある状態を作って測らせる
    Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 480,
    });
    try {
      let scale = -1;
      function Measured() {
        const s = useCanvasScale(960);
        scale = s.scale;
        return <div ref={s.ref} />;
      }
      render(<Measured />);
      expect(scale).toBe(0.5);
    } finally {
      delete (HTMLDivElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });
});
