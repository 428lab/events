import { describe, it, expect } from "vitest";
import { LIVE_H, LIVE_W } from "@eventer/shared";
import type { LiveElement, LiveScene } from "@eventer/shared";
import {
  copyScene,
  isColorBackground,
  newCameraElement,
  newDeckElement,
  newEventInfoElement,
  newImageElement,
  newScene,
  newTextElement,
} from "./liveScenes.js";

/**
 * 配信セット固有の操作 (#466 で画面から切り出した)。
 *
 * 並べ替えや重なり順のような型を見ない式は `editor/collection.test.ts` にある。
 * ここで押さえるのは「配信セットにしか無いもの」＝名前の付け方と、置いた
 * ばかりの要素の既定値。既定値が崩れると、置いた瞬間は画面の外・潰れて
 * つかめない、といった**置いてみるまで分からない**壊れ方をする。
 */

const scene = (over: Partial<LiveScene> = {}): LiveScene => ({
  id: "sc1",
  name: "開始前",
  background: "#0E1426",
  elements: [],
  ...over,
});

describe("シーンの名前", () => {
  it("新しいシーンは今ある数の次の番号で名付ける", () => {
    expect(newScene(0).name).toBe("シーン 1");
    expect(newScene(2).name).toBe("シーン 3");
  });

  it("写しは元と違う名前にする（一覧では名前しか見えない）", () => {
    expect(copyScene(scene()).name).toBe("開始前のコピー");
  });

  it("写しはシーンにも中の要素にも新しい id が振られる", () => {
    const src = scene({ elements: [newTextElement()] });
    const copy = copyScene(src);
    expect(copy.id).not.toBe(src.id);
    expect(copy.elements[0].id).not.toBe(src.elements[0].id);
  });

  it("背景と中身はそのまま写る", () => {
    const copy = copyScene(scene({ background: "#123456" }));
    expect(copy.background).toBe("#123456");
  });
});

describe("背景が単色かどうか", () => {
  it("色指定はカラーピッカーに渡せる", () => {
    expect(isColorBackground("#0E1426")).toBe(true);
    expect(isColorBackground("#fff")).toBe(true);
  });

  it("グラデーションは色として読めない", () => {
    expect(
      isColorBackground("linear-gradient(135deg, #0B3A34 0%, #0E1426 60%)"),
    ).toBe(false);
  });

  it("シーンがまだ無いときも落ちない", () => {
    expect(isColorBackground(undefined)).toBe(false);
  });
});

describe("置いたばかりの要素", () => {
  const created: LiveElement[] = [
    newTextElement(),
    newImageElement("https://example.test/a.png"),
    newCameraElement(),
    newDeckElement(),
    newEventInfoElement(),
  ];

  it("種類がひととおり作れる", () => {
    expect(created.map((e) => e.type)).toEqual([
      "text",
      "image",
      "camera",
      "deck",
      "eventInfo",
    ]);
  });

  it("画面の中に収まる位置と大きさで置かれる", () => {
    for (const el of created) {
      expect(el.x).toBeGreaterThanOrEqual(0);
      expect(el.y).toBeGreaterThanOrEqual(0);
      expect(el.x + el.w).toBeLessThanOrEqual(LIVE_W);
      expect(el.y + el.h).toBeLessThanOrEqual(LIVE_H);
    }
  });

  it("それぞれ違う id を持つ", () => {
    expect(new Set(created.map((e) => e.id)).size).toBe(created.length);
  });

  it("上げ終わった画像はその url を指す", () => {
    expect(newImageElement("https://example.test/a.png").src).toBe(
      "https://example.test/a.png",
    );
  });

  it("イベント情報は既定でイベント名を出す", () => {
    expect(newEventInfoElement().field).toBe("title");
  });

  it("スライドの窓は 16:9 のまま置く（配信画面と同じ比）", () => {
    const deck = newDeckElement();
    expect(deck.w / deck.h).toBeCloseTo(LIVE_W / LIVE_H);
  });
});
