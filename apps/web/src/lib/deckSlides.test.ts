import { describe, it, expect } from "vitest";
import type { DeckElement } from "@eventer/shared";
import {
  copyElements,
  expandGroup,
  groupElements,
  readSelection,
  toggleSelection,
  ungroupElements,
} from "./deckSlides.js";
import { DUPLICATE_OFFSET } from "./editor/collection.js";

/**
 * スライド **固有** の操作 (#466 で画面から切り出した)。
 *
 * 並べ替え・重なり順・まとめて動かす、といった型を見ない式は
 * `editor/collection.test.ts` にある。ここに残しているのは、
 * グループという「スライドにしか無い概念」が絡むぶんだけ。
 * グループが混ざると、片方を動かしたときにもう片方まで付いてくる。
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

/** 並びを見るための短縮 */
const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

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

  it("ずらす量と id の振り直しは共通の写しに任せている", () => {
    const [copy] = copyElements(els, ["a"]);
    expect(copy.x).toBe(10 + DUPLICATE_OFFSET);
    expect(copy.y).toBe(20 + DUPLICATE_OFFSET);
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
