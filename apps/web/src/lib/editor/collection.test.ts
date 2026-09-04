import { describe, it, expect } from "vitest";
import {
  DUPLICATE_OFFSET,
  applyPositions,
  copyByIds,
  copyPage,
  insertAfter,
  mapElementsAt,
  moveZ,
  nudgeByIds,
  patchAt,
  patchById,
  removeAt,
  removeByIds,
  swapAt,
  toBack,
  toFront,
} from "./collection.js";

/**
 * 並びの操作 (#466 でスライド編集と配信セット編集の共通部分として切り出した)。
 *
 * ここが壊れても画面はそれらしく描かれてしまう。並べ替えたつもりが入れ替わって
 * いない、写したはずが元を書き換えている、といった壊れ方は「投影して初めて
 * 気づく」たぐいなので、並びと id を直接確かめておく。
 *
 * **編集対象の型を見ない**のがこのファイルの存在理由なので、テスト側も
 * DeckElement / LiveElement ではなく、その場で作った素の形で確かめる。
 */

interface Item {
  id: string;
  x: number;
  y: number;
  label?: string;
}
interface Page {
  id: string;
  background: string;
  elements: Item[];
}

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  x: 0,
  y: 0,
  label: id,
  ...over,
});
const page = (id: string, elements: Item[] = []): Page => ({
  id,
  background: "#ffffff",
  elements,
});

/** 並びを見るための短縮 */
const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

describe("ページの並べ替え", () => {
  const pages = [page("a"), page("b"), page("c")];

  it("差し込んだページは指定した位置の直後に入る", () => {
    expect(ids(insertAfter(pages, 0, page("x")))).toEqual(["a", "x", "b", "c"]);
  });

  it("末尾の直後にも差し込める", () => {
    expect(ids(insertAfter(pages, 2, page("x")))).toEqual(["a", "b", "c", "x"]);
  });

  it("前へ動かすと隣と入れ替わる", () => {
    expect(ids(swapAt(pages, 2, 1))).toEqual(["a", "c", "b"]);
  });

  it("後ろへ動かすと隣と入れ替わる", () => {
    expect(ids(swapAt(pages, 0, 1))).toEqual(["b", "a", "c"]);
  });

  it("入れ替えても元の配列は変わらない", () => {
    swapAt(pages, 0, 1);
    expect(ids(pages)).toEqual(["a", "b", "c"]);
  });

  it("消したページだけが抜ける", () => {
    expect(ids(removeAt(pages, 1))).toEqual(["a", "c"]);
  });
});

describe("ページの写し", () => {
  const src = page("a", [item("e1"), item("e2")]);

  it("ページと中の要素すべてに新しい id が振られる", () => {
    const copy = copyPage(src);
    expect(copy.id).not.toBe("a");
    expect(ids(copy.elements)).not.toContain("e1");
    expect(ids(copy.elements)).not.toContain("e2");
    expect(new Set(ids(copy.elements)).size).toBe(2);
  });

  it("見た目に関わるものはそのまま写る", () => {
    const copy = copyPage(page("a", [item("e1", { label: "やあ" })]));
    expect(copy.background).toBe("#ffffff");
    expect(copy.elements[0].label).toBe("やあ");
    expect(copy.elements.length).toBe(1);
  });

  it("写した側をいじっても元のページは変わらない", () => {
    const copy = copyPage(src);
    copy.elements[0].x = 999;
    expect(src.elements[0].x).toBe(0);
  });
});

describe("ページ単位の書き換え", () => {
  const pages = [page("a", [item("e1")]), page("b", [item("e2")])];

  it("指したページの要素だけが差し替わる", () => {
    const next = mapElementsAt(pages, 1, (arr) => [...arr, item("e3")]);
    expect(ids(next[0].elements)).toEqual(["e1"]);
    expect(ids(next[1].elements)).toEqual(["e2", "e3"]);
  });

  it("範囲外を指したときは何も変わらない", () => {
    const next = mapElementsAt(pages, -1, () => []);
    expect(ids(next[0].elements)).toEqual(["e1"]);
    expect(ids(next[1].elements)).toEqual(["e2"]);
  });

  it("背景の差し替えは指したページだけに効く", () => {
    const next = patchAt(pages, 0, { background: "#000000" });
    expect(next[0].background).toBe("#000000");
    expect(next[1].background).toBe("#ffffff");
  });
});

describe("重なり順", () => {
  // 配列は後ろほど手前
  const els = [item("a"), item("b"), item("c"), item("d")];

  it("1段前へ出すと1つ後ろの要素と入れ替わる", () => {
    expect(ids(moveZ(els, "b", 1))).toEqual(["a", "c", "b", "d"]);
  });

  it("1段後ろへ下げると1つ前の要素と入れ替わる", () => {
    expect(ids(moveZ(els, "c", -1))).toEqual(["a", "c", "b", "d"]);
  });

  it("最前面をさらに前へ出しても動かない", () => {
    expect(ids(moveZ(els, "d", 1))).toEqual(["a", "b", "c", "d"]);
  });

  it("最背面をさらに後ろへ下げても動かない", () => {
    expect(ids(moveZ(els, "a", -1))).toEqual(["a", "b", "c", "d"]);
  });

  it("居ない要素を指しても並びは変わらない", () => {
    expect(ids(moveZ(els, "zz", 1))).toEqual(["a", "b", "c", "d"]);
  });

  it("動かせないときは入力をそのまま返す（変わっていないと分かるように）", () => {
    expect(moveZ(els, "d", 1)).toBe(els);
    expect(moveZ(els, "zz", 1)).toBe(els);
    // 動いたときは別の配列
    expect(moveZ(els, "b", 1)).not.toBe(els);
  });

  it("最前面へ出すとき、選んだもの同士の並びは保つ", () => {
    expect(ids(toFront(els, ["a", "c"]))).toEqual(["b", "d", "a", "c"]);
  });

  it("最背面へ下げるとき、選んだもの同士の並びは保つ", () => {
    expect(ids(toBack(els, ["b", "d"]))).toEqual(["b", "d", "a", "c"]);
  });
});

describe("位置と中身の書き換え", () => {
  const els = [item("a", { x: 10, y: 10 }), item("b", { x: 50, y: 50 })];

  it("矢印での移動は選んだものだけを動かす", () => {
    const next = nudgeByIds(els, ["a"], -1, 10);
    expect([next[0].x, next[0].y]).toEqual([9, 20]);
    expect([next[1].x, next[1].y]).toEqual([50, 50]);
  });

  it("掴んで動かし終えた位置をまとめて反映する", () => {
    const next = applyPositions(els, [
      { id: "a", x: 100, y: 200 },
      { id: "b", x: 300, y: 400 },
    ]);
    expect([next[0].x, next[0].y]).toEqual([100, 200]);
    expect([next[1].x, next[1].y]).toEqual([300, 400]);
  });

  it("渡されなかった要素の位置は変わらない", () => {
    const next = applyPositions(els, [{ id: "a", x: 1, y: 2 }]);
    expect([next[1].x, next[1].y]).toEqual([50, 50]);
  });

  it("指した要素の中身だけを差し替える", () => {
    const next = patchById(els, "b", { label: "変えた" });
    expect(next[1].label).toBe("変えた");
    expect(next[0].label).toBe("a");
  });

  it("消したものだけが抜ける", () => {
    expect(ids(removeByIds(els, ["a"]))).toEqual(["b"]);
  });
});

describe("要素の写し", () => {
  const els = [item("a", { x: 10, y: 20 }), item("b"), item("c")];

  it("少しずらして重なりが分かるようにする", () => {
    const [copy] = copyByIds(els, ["a"]);
    expect(copy.x).toBe(10 + DUPLICATE_OFFSET);
    expect(copy.y).toBe(20 + DUPLICATE_OFFSET);
  });

  it("写しには新しい id が振られる", () => {
    const copies = copyByIds(els, ["a", "b"]);
    expect(ids(copies)).not.toContain("a");
    expect(ids(copies)).not.toContain("b");
    expect(new Set(ids(copies)).size).toBe(2);
  });

  it("写しだけを返す（並べるのは呼ぶ側）", () => {
    expect(copyByIds(els, ["a", "c"]).length).toBe(2);
  });

  it("元の並びは変わらない", () => {
    copyByIds(els, ["a"]);
    expect(ids(els)).toEqual(["a", "b", "c"]);
    expect(els[0].x).toBe(10);
  });
});
