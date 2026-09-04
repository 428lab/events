import { describe, it, expect } from "vitest";
import type { DeckElement, DeckSlide } from "@eventer/shared";
import {
  applyPositions,
  bringToFront,
  copyElements,
  copySlide,
  expandGroup,
  groupElements,
  insertSlideAfter,
  mapSlideElements,
  moveElementZ,
  nudgeElements,
  patchElement,
  patchSlide,
  readSelection,
  removeElements,
  removeSlideAt,
  sendToBack,
  swapSlides,
  toggleSelection,
  ungroupElements,
} from "./deckSlides.js";

/**
 * スライドの中身をいじる操作 (#466 で画面から切り出した)。
 *
 * ここが壊れても画面はそれらしく描かれてしまう。並べ替えたつもりが入れ替わって
 * いない、写したはずが元を書き換えている、グループが混ざる、といった壊れ方は
 * 「投影して初めて気づく」たぐいなので、並びと id を直接確かめておく。
 */

function el(id: string, over: Partial<DeckElement> = {}): DeckElement {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    rotation: 0,
    text: id,
    ...over,
  };
}

function page(id: string, elements: DeckElement[] = []): DeckSlide {
  return { id, background: "#ffffff", elements };
}

/** 並びを見るための短縮 */
const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

describe("ページの並べ替え", () => {
  const slides = [page("a"), page("b"), page("c")];

  it("差し込んだページは指定した位置の直後に入る", () => {
    expect(ids(insertSlideAfter(slides, 0, page("x")))).toEqual([
      "a",
      "x",
      "b",
      "c",
    ]);
  });

  it("末尾の直後にも差し込める", () => {
    expect(ids(insertSlideAfter(slides, 2, page("x")))).toEqual([
      "a",
      "b",
      "c",
      "x",
    ]);
  });

  it("前へ動かすと隣と入れ替わる", () => {
    expect(ids(swapSlides(slides, 2, 1))).toEqual(["a", "c", "b"]);
  });

  it("後ろへ動かすと隣と入れ替わる", () => {
    expect(ids(swapSlides(slides, 0, 1))).toEqual(["b", "a", "c"]);
  });

  it("入れ替えても元の配列は変わらない", () => {
    swapSlides(slides, 0, 1);
    expect(ids(slides)).toEqual(["a", "b", "c"]);
  });

  it("消したページだけが抜ける", () => {
    expect(ids(removeSlideAt(slides, 1))).toEqual(["a", "c"]);
  });
});

describe("ページの写し", () => {
  const src = page("a", [el("e1"), el("e2", { groupId: "g1" })]);

  it("ページと中の要素すべてに新しい id が振られる", () => {
    const copy = copySlide(src);
    expect(copy.id).not.toBe("a");
    expect(ids(copy.elements)).not.toContain("e1");
    expect(ids(copy.elements)).not.toContain("e2");
    expect(new Set(ids(copy.elements)).size).toBe(2);
  });

  it("見た目に関わるものはそのまま写る", () => {
    const copy = copySlide(page("a", [el("e1", { text: "やあ" })]));
    expect(copy.background).toBe("#ffffff");
    expect(copy.elements[0].text).toBe("やあ");
    expect(copy.elements.length).toBe(1);
  });

  it("写した側をいじっても元のページは変わらない", () => {
    const copy = copySlide(src);
    copy.elements[0].x = 999;
    expect(src.elements[0].x).toBe(0);
  });
});

describe("ページ単位の書き換え", () => {
  const slides = [page("a", [el("e1")]), page("b", [el("e2")])];

  it("指したページの要素だけが差し替わる", () => {
    const next = mapSlideElements(slides, 1, (arr) => [...arr, el("e3")]);
    expect(ids(next[0].elements)).toEqual(["e1"]);
    expect(ids(next[1].elements)).toEqual(["e2", "e3"]);
  });

  it("範囲外を指したときは何も変わらない", () => {
    const next = mapSlideElements(slides, -1, () => []);
    expect(ids(next[0].elements)).toEqual(["e1"]);
    expect(ids(next[1].elements)).toEqual(["e2"]);
  });

  it("背景の差し替えは指したページだけに効く", () => {
    const next = patchSlide(slides, 0, { background: "#000000" });
    expect(next[0].background).toBe("#000000");
    expect(next[1].background).toBe("#ffffff");
  });
});

describe("重なり順", () => {
  // 配列は後ろほど手前
  const els = [el("a"), el("b"), el("c"), el("d")];

  it("1段前へ出すと1つ後ろの要素と入れ替わる", () => {
    expect(ids(moveElementZ(els, "b", 1))).toEqual(["a", "c", "b", "d"]);
  });

  it("1段後ろへ下げると1つ前の要素と入れ替わる", () => {
    expect(ids(moveElementZ(els, "c", -1))).toEqual(["a", "c", "b", "d"]);
  });

  it("最前面をさらに前へ出しても動かない", () => {
    expect(ids(moveElementZ(els, "d", 1))).toEqual(["a", "b", "c", "d"]);
  });

  it("最背面をさらに後ろへ下げても動かない", () => {
    expect(ids(moveElementZ(els, "a", -1))).toEqual(["a", "b", "c", "d"]);
  });

  it("最前面へ出すとき、選んだもの同士の並びは保つ", () => {
    expect(ids(bringToFront(els, ["a", "c"]))).toEqual(["b", "d", "a", "c"]);
  });

  it("最背面へ下げるとき、選んだもの同士の並びは保つ", () => {
    expect(ids(sendToBack(els, ["b", "d"]))).toEqual(["b", "d", "a", "c"]);
  });
});

describe("選択", () => {
  const els = [
    el("a", { groupId: "g1" }),
    el("b", { groupId: "g1" }),
    el("c"),
    el("d", { groupId: "g2" }),
  ];

  it("グループの一員を選ぶと相方も一緒に選ばれる", () => {
    expect(expandGroup(els, "a")).toEqual(["a", "b"]);
  });

  it("グループに属さない要素は本人だけ", () => {
    expect(expandGroup(els, "c")).toEqual(["c"]);
  });

  it("別のグループまでは広がらない", () => {
    expect(expandGroup(els, "d")).toEqual(["d"]);
  });

  it("居ない要素を指しても本人の id だけを返す", () => {
    expect(expandGroup(els, "zz")).toEqual(["zz"]);
  });

  it("入っていないものを追加選択すると足される", () => {
    expect(toggleSelection(["c"], ["a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("全部入っているものを追加選択すると外れる", () => {
    expect(toggleSelection(["a", "b", "c"], ["a", "b"])).toEqual(["c"]);
  });

  it("一部だけ入っているときは残りが足される（外さない）", () => {
    expect(toggleSelection(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("1つだけ選んでいるときに限り、中身を編集できる相手が決まる", () => {
    expect(readSelection(els, ["c"]).one?.id).toBe("c");
    expect(readSelection(els, ["a", "b"]).one).toBeNull();
    expect(readSelection(els, []).one).toBeNull();
  });

  it("今のページに無い id は選択の実体に含めない", () => {
    const selection = readSelection(els, ["a", "zz"]);
    expect(ids(selection.els)).toEqual(["a"]);
    expect(selection.ids).toEqual(["a", "zz"]);
  });
});

describe("要素の写し", () => {
  const els = [el("a", { x: 10, y: 20 }), el("b", { groupId: "g1" }), el("c")];

  it("少しずらして重なりが分かるようにする", () => {
    const [copy] = copyElements(els, ["a"]);
    expect(copy.x).toBe(30);
    expect(copy.y).toBe(40);
    expect(copy.id).not.toBe("a");
  });

  it("1つだけ写したときは元のグループを引き継ぐ", () => {
    expect(copyElements(els, ["b"])[0].groupId).toBe("g1");
  });

  it("まとめて写したときは写した側だけで新しいグループになる", () => {
    const copies = copyElements(els, ["b", "c"]);
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe("g1");
  });

  it("写しだけを返す（並べるのは呼ぶ側）", () => {
    expect(copyElements(els, ["a", "c"]).length).toBe(2);
  });
});

describe("グループ", () => {
  const els = [el("a"), el("b"), el("c", { groupId: "old" })];

  it("選んだものが1つのグループになる", () => {
    const next = groupElements(els, ["a", "b"]);
    expect(next[0].groupId).toBe(next[1].groupId);
    expect(next[0].groupId).toBeTruthy();
  });

  it("選んでいないものは巻き込まない", () => {
    expect(groupElements(els, ["a", "b"])[2].groupId).toBe("old");
  });

  it("解除すると所属が消える", () => {
    expect(ungroupElements(els, ["c"])[2].groupId).toBeUndefined();
  });
});

describe("位置と中身の書き換え", () => {
  const els = [el("a", { x: 10, y: 10 }), el("b", { x: 50, y: 50 })];

  it("矢印での移動は選んだものだけを動かす", () => {
    const next = nudgeElements(els, ["a"], -1, 10);
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
    const next = patchElement(els, "b", { text: "変えた" });
    expect(next[1].text).toBe("変えた");
    expect(next[0].text).toBe("a");
  });

  it("消したものだけが抜ける", () => {
    expect(ids(removeElements(els, ["a"]))).toEqual(["b"]);
  });
});
