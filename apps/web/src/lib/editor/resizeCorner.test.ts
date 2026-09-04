import { describe, it, expect } from "vitest";
import { MIN_SIZE, handleMetrics, resizeRect } from "./resizeCorner.js";

/**
 * 四隅ハンドルでの変形 (#466 で2つのエディタから1か所に寄せた)。
 *
 * 北・西側をつかんだときは反対側の辺を固定したいので原点も動かす。この符号を
 * 間違えると「掴んだ隅と逆側が動く」「掴んだ瞬間に倍の量ずれる」という挙動になる。
 * 下限で止めたあと原点が行き過ぎない、というのも目で見て気づきにくいので押さえる。
 */

const start = { x: 100, y: 100, w: 200, h: 100 };

describe("南東（右下）をつかむ", () => {
  it("引っぱった分だけ大きくなる", () => {
    expect(resizeRect(start, "se", 50, 40)).toEqual({
      x: 100,
      y: 100,
      w: 250,
      h: 140,
    });
  });

  it("原点は動かない", () => {
    const r = resizeRect(start, "se", -50, -40);
    expect([r.x, r.y]).toEqual([100, 100]);
  });
});

describe("北西（左上）をつかむ", () => {
  it("右下の辺を固定したまま、原点ごと動く", () => {
    expect(resizeRect(start, "nw", 50, 40)).toEqual({
      x: 150,
      y: 140,
      w: 150,
      h: 60,
    });
  });

  it("外へ引っぱると原点が戻って大きくなる", () => {
    expect(resizeRect(start, "nw", -50, -40)).toEqual({
      x: 50,
      y: 60,
      w: 250,
      h: 140,
    });
  });
});

describe("北東（右上）をつかむ", () => {
  it("横は原点そのまま、縦だけ原点が動く", () => {
    expect(resizeRect(start, "ne", 50, 40)).toEqual({
      x: 100,
      y: 140,
      w: 250,
      h: 60,
    });
  });
});

describe("南西（左下）をつかむ", () => {
  it("横だけ原点が動く", () => {
    expect(resizeRect(start, "sw", 50, 40)).toEqual({
      x: 150,
      y: 100,
      w: 150,
      h: 140,
    });
  });
});

describe("潰しすぎない", () => {
  it("下限より小さくはならない", () => {
    const r = resizeRect(start, "se", -1000, -1000);
    expect([r.w, r.h]).toEqual([MIN_SIZE, MIN_SIZE]);
  });

  it("下限で止まったあと、原点はそれ以上進まない", () => {
    // 右下の辺（x=300, y=200）に張り付いたまま、下限の大きさになる
    const r = resizeRect(start, "nw", 1000, 1000);
    expect(r).toEqual({
      x: 300 - MIN_SIZE,
      y: 200 - MIN_SIZE,
      w: MIN_SIZE,
      h: MIN_SIZE,
    });
  });
});

describe("ハンドルの大きさ", () => {
  it("縮小されたキャンバスでは、画面上で同じ大きさに見えるよう逆に補正する", () => {
    expect(handleMetrics(0.5).size).toBe(48);
  });

  it("拡大されても押せる大きさを下回らない", () => {
    expect(handleMetrics(4).size).toBe(12);
    expect(handleMetrics(4).border).toBe(1);
  });

  it("まだ測れていない（0）ときは等倍として扱う", () => {
    expect(handleMetrics(0)).toEqual({ size: 24, border: 2 });
  });
});
