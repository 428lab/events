import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEditorHistory } from "./useEditorHistory.js";

/**
 * 編集画面の Undo/Redo (#466 で2つのエディタから1か所に寄せた)。
 *
 * 「戻る」は壊れても気づきにくい。押しても何も起きない、1回で2手ぶん戻る、
 * 戻ったあとに編集したのに「進む」が押せたまま、といった壊れ方をする。
 * 積む単位（連続した変更を1手にまとめる）まで含めて押さえる。
 */

let restored = 0;

/** 文字列を編集対象に見立てた覗き窓 */
function Probe() {
  const [content, setContent] = useState<string | null>(null);
  const history = useEditorHistory<string>({
    content,
    setContent,
    onRestore: () => {
      restored += 1;
    },
  });
  return (
    <div>
      <span data-testid="content">{content ?? "-"}</span>
      <span data-testid="canUndo">{String(history.canUndo)}</span>
      <span data-testid="canRedo">{String(history.canRedo)}</span>
      <button
        data-testid="load"
        onClick={() => {
          setContent("A");
          history.reset("A");
        }}
      >
        load
      </button>
      <button data-testid="edit" onClick={() => setContent((c) => `${c}!`)}>
        edit
      </button>
      <button data-testid="undo" onClick={history.undo}>
        undo
      </button>
      <button data-testid="redo" onClick={history.redo}>
        redo
      </button>
    </div>
  );
}

const read = (id: string) => screen.getByTestId(id).textContent;
const click = (id: string) => fireEvent.click(screen.getByTestId(id));
/** まとめる猶予（500ms）を過ぎさせる */
const settle = () => act(() => void vi.advanceTimersByTime(600));
/** 猶予には届かない間 */
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  restored = 0;
  vi.useFakeTimers();
  render(<Probe />);
  click("load");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("読み込み直後", () => {
  it("戻る先も進む先も無い", () => {
    expect(read("canUndo")).toBe("false");
    expect(read("canRedo")).toBe("false");
  });

  it("サーバーから受け取った中身より前には戻れない", () => {
    click("undo");
    expect(read("content")).toBe("A");
  });
});

describe("積む単位", () => {
  it("猶予の間に続いた変更は1手にまとまる", () => {
    click("edit");
    // 猶予に届かないうちに次を打つ。ここで積まれてしまうと1手が細切れになる
    wait(300);
    click("edit");
    settle();
    click("undo");
    expect(read("content")).toBe("A");
  });

  it("手を止めるたびに積み直すので、打ち続けている間は積まれない", () => {
    click("edit");
    wait(400);
    click("edit");
    wait(400);
    click("edit");
    wait(400);
    expect(read("canRedo")).toBe("false");
    settle();
    click("undo");
    expect(read("content")).toBe("A");
  });

  it("猶予をまたいだ変更は別の手として積まれる", () => {
    click("edit");
    settle();
    click("edit");
    settle();
    click("undo");
    expect(read("content")).toBe("A!");
    click("undo");
    expect(read("content")).toBe("A");
  });

  it("まだ積まれていない変更も戻せる（押せる状態になる）", () => {
    click("edit");
    expect(read("canUndo")).toBe("true");
    click("undo");
    expect(read("content")).toBe("A");
  });
});

describe("戻ると進む", () => {
  it("戻したあとに進めると元へ戻る", () => {
    click("edit");
    settle();
    click("undo");
    expect(read("content")).toBe("A");
    expect(read("canRedo")).toBe("true");
    click("redo");
    expect(read("content")).toBe("A!");
  });

  it("戻したあとに編集すると、進む先は捨てられる", () => {
    click("edit");
    settle();
    click("undo");
    click("edit");
    settle();
    expect(read("canRedo")).toBe("false");
  });

  it("戻る先が尽きたら押せなくなる", () => {
    click("edit");
    settle();
    click("undo");
    expect(read("canUndo")).toBe("false");
  });

  it("戻した／進めたときに選択を外させる", () => {
    click("edit");
    settle();
    click("undo");
    click("redo");
    expect(restored).toBe(2);
  });

  it("進む先が無いときに押しても何も起きない", () => {
    click("edit");
    settle();
    click("redo");
    expect(read("content")).toBe("A!");
  });
});
