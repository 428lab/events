import { describe, expect, it } from "vitest";
import { deckContentSchema, type DeckElement, type DeckSlide } from "@eventer/shared";
import {
  comparePositioned,
  isDeckPos,
  placeInArrayOrder,
  posBetween,
  prepareLoadedContent,
  withDeckPositions,
} from "./deckPositions.js";
import { moveZ, swapAt, toBack, toFront } from "./editor/collection.js";

/** 並びの位置キー（docs/team-deck-live-sync.md §5.2） */

const el = (id: string, pos?: string): DeckElement => ({ id, type: "text", x: 0, y: 0, w: 10, h: 10, rotation: 0, ...(pos ? { pos } : {}) });
const slide = (id: string, elements: DeckElement[] = [], pos?: string): DeckSlide => ({ id, background: "#ffffff", elements, ...(pos ? { pos } : {}) });
const keys = <T extends { pos?: string }>(items: T[]) => items.map((i) => i.pos!);
const ascending = (list: string[]) => list.every((k, i) => i === 0 || list[i - 1] < k);

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("posBetween", () => {
  it("作ったキーは両隣の間に入り、末尾が 0 にならず、形の検証を通る", () => {
    const rand = seeded(1);
    for (let n = 0; n < 2000; n++) {
      const list = placeInArrayOrder(Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i): { id: string; pos?: string } => ({ id: `x${i}` })));
      const i = Math.floor(rand() * (list.length + 1));
      const lo = i === 0 ? null : list[i - 1].pos!;
      const hi = i === list.length ? null : list[i].pos!;
      const k = posBetween(lo, hi)!;
      expect(isDeckPos(k)).toBe(true);
      expect(k.endsWith("0")).toBe(false);
      if (lo !== null) expect(lo < k).toBe(true);
      if (hi !== null) expect(k < hi).toBe(true);
    }
  });

  it("同じ場所に何度も差し込んでも、間のキーが作れ続ける", () => {
    let lo = "V";
    const hi = "W";
    for (let n = 0; n < 25; n++) {
      const k = posBetween(lo, hi)!;
      expect(lo < k && k < hi).toBe(true);
      lo = k;
    }
  });

  it("間が空のとき（hi が lo の後ろに 0 を足しただけ、順が逆）は null", () => {
    expect(posBetween("a", "a0")).toBeNull();
    expect(posBetween("b", "a")).toBeNull();
    expect(posBetween("a", "a")).toBeNull();
  });
});

describe("placeInArrayOrder", () => {
  it("並べ替えで書き換わる pos は、動かしたものだけ", () => {
    const base = placeInArrayOrder(["a", "b", "c", "d", "e"].map((id) => el(id)));
    const moved = moveZ(base, "b", 1); // a c b d e
    const placed = placeInArrayOrder(moved);
    expect(placed.map((e) => e.id)).toEqual(["a", "c", "b", "d", "e"]);
    expect(ascending(keys(placed))).toBe(true);
    const changed = placed.filter((e, i) => e !== moved[i]).map((e) => e.id);
    expect(changed).toHaveLength(1);
  });

  it("最前面・最背面・ページの入れ替えでも、配列の順で pos が増える", () => {
    const base = placeInArrayOrder(["a", "b", "c", "d"].map((id) => el(id)));
    for (const next of [toFront(base, ["a", "c"]), toBack(base, ["d"]), swapAt(base, 0, 3)]) {
      expect(ascending(keys(placeInArrayOrder(next)))).toBe(true);
    }
  });

  it("写し（同じ pos を持つ要素）は元を残し、写しにだけ新しいキーを振る", () => {
    const base = placeInArrayOrder(["a", "b"].map((id) => el(id)));
    const copies = base.map((e) => ({ ...e, id: `${e.id}-copy` }));
    const placed = placeInArrayOrder([...base, ...copies]);
    expect(placed[0]).toBe(base[0]);
    expect(placed[1]).toBe(base[1]);
    expect(ascending(keys(placed))).toBe(true);
  });

  it("何も変えなければ、同じ配列を返す", () => {
    const base = placeInArrayOrder(["a", "b", "c"].map((id) => el(id)));
    expect(placeInArrayOrder(base)).toBe(base);
  });

  it("間に作れないキー（末尾 0）が詰まっていても、並び全体を振り直して順を保つ", () => {
    const stuck = [el("a", "a"), el("new"), el("b", "a0")];
    const placed = placeInArrayOrder(stuck);
    expect(placed.map((e) => e.id)).toEqual(["a", "new", "b"]);
    expect(ascending(keys(placed))).toBe(true);
  });

  it("ランダムな並べ替え・差し込み・削除を続けても、配列の順で増え、32 字以内に収まる", () => {
    const rand = seeded(7);
    let list = placeInArrayOrder(Array.from({ length: 5 }, (_, i) => el(`e${i}`)));
    let next = 5;
    for (let n = 0; n < 3000; n++) {
      const r = rand();
      const a = [...list];
      if (r < 0.35 && a.length < 200) a.splice(Math.floor(rand() * (a.length + 1)), 0, el(`e${next++}`));
      else if (r < 0.5 && a.length > 1) a.splice(Math.floor(rand() * a.length), 1);
      else if (a.length > 1) {
        const [x] = a.splice(Math.floor(rand() * a.length), 1);
        a.splice(Math.floor(rand() * (a.length + 1)), 0, x);
      }
      list = placeInArrayOrder(a);
      expect(ascending(keys(list))).toBe(true);
      expect(list.every((e) => isDeckPos(e.pos))).toBe(true);
    }
  });
});

describe("withDeckPositions / prepareLoadedContent", () => {
  it("保存する中身は形の検証を通り、配列の順と pos の順が一致する", () => {
    const slides = withDeckPositions([slide("s1", [el("a"), el("b")]), slide("s2", [el("c")])]);
    const parsed = deckContentSchema.parse({ slides });
    expect(parsed.slides.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(ascending(keys(parsed.slides))).toBe(true);
    expect(ascending(keys(parsed.slides[0].elements))).toBe(true);
  });

  it("pos の無い既存のデッキは、配列の順に振る。持っているキーは変えない", () => {
    const content = { slides: [slide("s1", [el("a"), el("b")]), slide("s2")] };
    const prepared = prepareLoadedContent(content);
    expect(prepared.slides.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(prepared.slides.every((s) => isDeckPos(s.pos))).toBe(true);
    expect(prepareLoadedContent(prepared)).toBe(prepared);
  });

  it("読み込むときは pos が正。配列の順が食い違っていても pos の順に並べ、キーは振り直さない", () => {
    const content = { slides: [slide("s2", [], "m"), slide("s1", [el("b", "x"), el("a", "c")], "c")] };
    const prepared = prepareLoadedContent(content);
    expect(prepared.slides.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(prepared.slides[0].elements.map((e) => e.id)).toEqual(["a", "b"]);
    expect(keys(prepared.slides)).toEqual(["c", "m"]);
  });

  it("一部だけ pos を持つときは、持たないものにだけ間のキーを振る", () => {
    const content = { slides: [slide("s1", [el("a", "c"), el("new"), el("b", "m")])] };
    const prepared = prepareLoadedContent(content);
    const els = prepared.slides[0].elements;
    expect(els.map((e) => e.id)).toEqual(["a", "new", "b"]);
    expect(els[0].pos).toBe("c");
    expect(els[2].pos).toBe("m");
    expect("c" < els[1].pos! && els[1].pos! < "m").toBe(true);
  });

  it("同じ pos のときは id 順", () => {
    expect([el("b", "k"), el("a", "k")].sort(comparePositioned).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("形の検証は、許していない文字・長すぎるキーを弾く", () => {
    expect(deckContentSchema.safeParse({ slides: [slide("s1", [], "a-b")] }).success).toBe(false);
    expect(deckContentSchema.safeParse({ slides: [slide("s1", [], "a".repeat(33))] }).success).toBe(false);
    expect(deckContentSchema.safeParse({ slides: [slide("s1", [el("e", "Zz9")], "a".repeat(32))] }).success).toBe(true);
  });
});
