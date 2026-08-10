import { describe, expect, it, beforeEach } from "vitest";
import {
  BG_STORAGE_KEY,
  DEFAULT_CARD_LOOK,
  THEME_STORAGE_KEY,
  cardLook,
  cardLookKey,
  loadLocalCardLook,
  saveLocalCardLook,
} from "./cardLook.js";

/**
 * カードの見た目の決め方 (#334)。
 *
 * 「持ち主の値が最優先、無いときだけ手元の既定」を1か所で守るための土台。
 * ここが崩れると、他人のカードが見る人の配色で描かれてしまう。
 */

beforeEach(() => {
  localStorage.clear();
});

describe("cardLook", () => {
  it("持ち主が決めた組み合わせをそのまま使う（手元の既定より優先）", () => {
    saveLocalCardLook({ variant: "topo", theme: "teal" });
    expect(cardLook("arcs-rose")).toEqual({ variant: "arcs", theme: "rose" });
  });

  it("持ち主が一度も決めていなければ手元の既定を借りる", () => {
    saveLocalCardLook({ variant: "topo", theme: "teal" });
    expect(cardLook(null)).toEqual({ variant: "topo", theme: "teal" });
  });

  it("知らない値・壊れた値は既定にそろえる", () => {
    expect(cardLook("こわれた-値")).toEqual(DEFAULT_CARD_LOOK);
    expect(cardLook("rosette-")).toEqual(DEFAULT_CARD_LOOK);
  });

  it("片方だけ有効なら、有効なほうは持ち主の値を使う", () => {
    expect(cardLook("arcs-しらない色")).toEqual({
      variant: "arcs",
      theme: DEFAULT_CARD_LOOK.theme,
    });
  });

  it("保存キーは 背景-配色 の形", () => {
    expect(cardLookKey({ variant: "flow", theme: "amber" })).toBe("flow-amber");
  });
});

describe("手元の既定", () => {
  it("何も選んでいなければ既定", () => {
    expect(loadLocalCardLook()).toEqual(DEFAULT_CARD_LOOK);
  });

  it("保存した値を読み戻せる", () => {
    saveLocalCardLook({ variant: "flow", theme: "mono" });
    expect(localStorage.getItem(BG_STORAGE_KEY)).toBe("flow");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("mono");
    expect(loadLocalCardLook()).toEqual({ variant: "flow", theme: "mono" });
  });
});
