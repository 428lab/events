import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { DeckCanvas } from "../../components/DeckCanvas.js";
import { LiveCanvas } from "../../components/LiveCanvas.js";
import type { DeckElementCommands } from "../deckSlides.js";
import type { LiveElementCommands } from "../liveScenes.js";
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

/**
 * 使う側が前提を守っているか。
 *
 * このフックには「ref を付けた要素を、呼ぶ部品の中で必ず描く」という前提がある。
 * 守れているかは**そのフックだけを見ても分からない**ので、実際の2つの
 * キャンバスを一番何も無い状態（描くページ／シーンがまだ無い）で描いて、
 * それでも測りに行くことを確かめる。
 *
 * ここが落ちるときの意味は「測る要素より前に早期 return が入った」。
 * そのまま出すと、中身が入っても倍率が 0 のままで**真っ白なキャンバス**になり、
 * エラーが出ないので気づけない。以前あった `ready` 引数はこの落とし穴を
 * 呼ぶ側に押し付けるものだったので落とした。前提を守らせるのはこのテスト。
 */
describe("キャンバスの部品が前提を守っているか", () => {
  /** 何も描くものが無い状態では手も触れられないので、中身は空で構わない */
  const noCommands = {} as DeckElementCommands & LiveElementCommands;

  it("スライド編集：ページがまだ無くても測りに行く", () => {
    render(
      <DeckCanvas
        slide={undefined}
        selection={{ ids: [], els: [], one: null }}
        multiSelect={false}
        commands={noCommands}
        onSelect={() => {}}
        onSelectOnly={() => {}}
        onSelectNone={() => {}}
      />,
    );
    expect(observed).toBe(1);
  });

  it("配信セット編集：シーンがまだ無くても測りに行く", () => {
    render(
      <LiveCanvas
        scene={undefined}
        selected={null}
        commands={noCommands}
        onSelect={() => {}}
        onSelectNone={() => {}}
      />,
    );
    expect(observed).toBe(1);
  });
});
