import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useEditorKeyboard } from "./useEditorKeyboard.js";
import type { EditorKeyCommands } from "./useEditorKeyboard.js";

/**
 * 編集画面のキーボード操作 (#466 で2つのエディタから1か所に寄せた)。
 *
 * いちばん怖いのは、テキストを打っている最中に Backspace や Ctrl+D が
 * 要素そのものへ効いてしまうこと。打った文字が消えるどころか要素ごと消える。
 * どのキーがどの操作に繋がるかと、打っている最中は何も起きないことを押さえる。
 */

/** 命令はすべて記録用の関数。変えたいのは「選んでいるか」だけ */
function commands(over: { hasSelection?: boolean; canGroup?: boolean } = {}) {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    hasSelection: true,
    remove: vi.fn(),
    duplicate: vi.fn(),
    nudge: vi.fn<(dx: number, dy: number) => void>(),
    group: vi.fn(),
    canGroup: true,
    ...over,
  };
}

function Probe({ c }: { c: EditorKeyCommands }) {
  useEditorKeyboard(c);
  return <input data-testid="text" />;
}

/** 命令を組み立てて画面に載せ、キーを送れる状態にする */
function arrange(over: { hasSelection?: boolean; canGroup?: boolean } = {}) {
  const c = commands(over);
  const view = render(<Probe c={c} />);
  return { c, view };
}

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
}

describe("戻る・進む", () => {
  it("Ctrl+Z で戻る", () => {
    const { c } = arrange();
    press("z", { ctrlKey: true });
    expect(c.undo).toHaveBeenCalled();
    expect(c.redo).not.toHaveBeenCalled();
  });

  it("Cmd+Z でも戻る", () => {
    const { c } = arrange();
    press("z", { metaKey: true });
    expect(c.undo).toHaveBeenCalled();
  });

  it("Shift を足すと進む", () => {
    const { c } = arrange();
    press("z", { ctrlKey: true, shiftKey: true });
    expect(c.redo).toHaveBeenCalled();
    expect(c.undo).not.toHaveBeenCalled();
  });

  it("Ctrl+Y でも進む", () => {
    const { c } = arrange();
    press("y", { ctrlKey: true });
    expect(c.redo).toHaveBeenCalled();
  });

  it("大文字で届いても同じ", () => {
    const { c } = arrange();
    press("Z", { ctrlKey: true });
    expect(c.undo).toHaveBeenCalled();
  });

  it("何も選んでいなくても戻れる", () => {
    const { c } = arrange({ hasSelection: false });
    press("z", { ctrlKey: true });
    expect(c.undo).toHaveBeenCalled();
  });
});

describe("複製とグループ化", () => {
  it("Ctrl+D で複製する", () => {
    const { c } = arrange();
    press("d", { ctrlKey: true });
    expect(c.duplicate).toHaveBeenCalled();
  });

  it("何も選んでいなければ複製しない", () => {
    const { c } = arrange({ hasSelection: false });
    press("d", { ctrlKey: true });
    expect(c.duplicate).not.toHaveBeenCalled();
  });

  it("Ctrl+G でまとめる", () => {
    const { c } = arrange();
    press("g", { ctrlKey: true });
    expect(c.group).toHaveBeenCalled();
  });

  it("2つ以上選んでいなければまとめない", () => {
    const { c } = arrange({ canGroup: false });
    press("g", { ctrlKey: true });
    expect(c.group).not.toHaveBeenCalled();
  });
});

describe("削除と移動", () => {
  it("Delete で消す", () => {
    const { c } = arrange();
    press("Delete");
    expect(c.remove).toHaveBeenCalled();
  });

  it("Backspace でも消す", () => {
    const { c } = arrange();
    press("Backspace");
    expect(c.remove).toHaveBeenCalled();
  });

  it("何も選んでいなければ消さない", () => {
    const { c } = arrange({ hasSelection: false });
    press("Delete");
    expect(c.remove).not.toHaveBeenCalled();
  });

  it("矢印で1つぶん動かす", () => {
    const { c } = arrange();
    press("ArrowLeft");
    press("ArrowRight");
    press("ArrowUp");
    press("ArrowDown");
    expect(c.nudge.mock.calls).toEqual([
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]);
  });

  it("Shift を足すと大きく動かす", () => {
    const { c } = arrange();
    press("ArrowRight", { shiftKey: true });
    press("ArrowUp", { shiftKey: true });
    expect(c.nudge.mock.calls).toEqual([
      [10, 0],
      [0, -10],
    ]);
  });

  it("何も選んでいなければ動かさない", () => {
    const { c } = arrange({ hasSelection: false });
    press("ArrowRight");
    expect(c.nudge).not.toHaveBeenCalled();
  });
});

describe("文字を打っている最中", () => {
  it("Backspace は要素ではなく文字に効く（何も呼ばない）", () => {
    const { c, view } = arrange();
    view.getByTestId("text").focus();
    press("Backspace");
    expect(c.remove).not.toHaveBeenCalled();
  });

  it("矢印はカーソル移動なので要素を動かさない", () => {
    const { c, view } = arrange();
    view.getByTestId("text").focus();
    press("ArrowRight");
    expect(c.nudge).not.toHaveBeenCalled();
  });

  it("Ctrl+Z は打っている文字に効かせる（要素の履歴は動かさない）", () => {
    const { c, view } = arrange();
    view.getByTestId("text").focus();
    press("z", { ctrlKey: true });
    expect(c.undo).not.toHaveBeenCalled();
  });

  it("Ctrl+D も効かせない", () => {
    const { c, view } = arrange();
    view.getByTestId("text").focus();
    press("d", { ctrlKey: true });
    expect(c.duplicate).not.toHaveBeenCalled();
  });
});

describe("関わらないキー", () => {
  it("修飾キー付きの他の組み合わせはブラウザに任せる", () => {
    const { c } = arrange();
    press("c", { ctrlKey: true });
    press("s", { ctrlKey: true });
    expect(c.duplicate).not.toHaveBeenCalled();
    expect(c.remove).not.toHaveBeenCalled();
    expect(c.nudge).not.toHaveBeenCalled();
  });

  it("命令の差し替えを追う（古い関数を呼ばない）", () => {
    const first = commands();
    const { rerender } = render(<Probe c={first} />);
    const second = commands();
    rerender(<Probe c={second} />);
    press("z", { ctrlKey: true });
    expect(first.undo).not.toHaveBeenCalled();
    expect(second.undo).toHaveBeenCalled();
  });
});
