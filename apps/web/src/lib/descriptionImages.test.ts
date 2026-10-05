import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_DESCRIPTION_IMAGE } from "@eventer/shared";
import { insertAtSelection, removeImageReferences, resizeForDescription } from "./descriptionImages.js";

const URL1 = "/api/events/e/description-images/a";

describe("insertAtSelection (D-DESC-IMAGE)", () => {
  it("選択範囲を置き換え、行の途中なら前後に改行を補う", () => {
    expect(insertAtSelection("abcdef", "X", { start: 2, end: 4 })).toEqual({ value: "ab\nX\nef", caret: 4 });
  });
  it("行頭・行末では余計な改行を足さない", () => {
    expect(insertAtSelection("a\nb", "X", { start: 2, end: 2 }).value).toBe("a\nX\nb");
    expect(insertAtSelection("", "X", null)).toEqual({ value: "X", caret: 1 });
  });
  it("位置が分からなければ末尾", () => {
    expect(insertAtSelection("abc", "X", null).value).toBe("abc\nX");
  });
  it("範囲外の位置は丸める", () => {
    expect(insertAtSelection("abc", "X", { start: 99, end: 120 }).value).toBe("abc\nX");
  });
});

describe("removeImageReferences (D-DESC-IMAGE)", () => {
  it("画像だけの行は行ごと、文中の参照はその部分だけ消す", () => {
    const text = `上\n![](${URL1})\n下 ![alt](<${URL1}>) 尾\n![](${URL1}b)`;
    expect(removeImageReferences(text, URL1)).toBe(`上\n下  尾\n![](${URL1}b)`);
  });
  it("最終行の参照も消す・title 付きも消す", () => {
    expect(removeImageReferences(`a\n![x](${URL1} "t")`, URL1)).toBe("a\n");
  });
  it("URL の特殊文字を正規表現として解釈しない", () => {
    expect(removeImageReferences("![](/a.b)", "/a?b")).toBe("![](/a.b)");
  });
});

describe("resizeForDescription (D-DESC-IMAGE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubImage(width: number, height: number) {
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = width;
        naturalHeight = height;
        width = width;
        height = height;
        onload: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    // jsdom の URL には createObjectURL が無い
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:x");
        static revokeObjectURL = vi.fn();
      },
    );
  }

  /** 書き出し結果を (形式, 幅, 品質) から決める偽の canvas */
  function stubCanvas(encode: (mime: string, w: number, q: number) => Blob) {
    const sizes: Array<[string, number, number]> = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: () => {},
      drawImage: () => {},
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
      mime?: string,
      q?: number,
    ) {
      sizes.push([mime!, this.width, q!]);
      cb(encode(mime!, this.width, q!));
    });
    return sizes;
  }

  const blobOf = (type: string, bytes: number) => new Blob([new Uint8Array(bytes)], { type });

  it("WebP で1MB以内に収まるまで品質→寸法の順に下げる", async () => {
    stubImage(6000, 4000);
    const calls = stubCanvas((mime, w) => blobOf(mime, w >= 2048 ? 2_000_000 : 900_000));
    const out = await resizeForDescription(new Blob(["x"]));
    expect(out.type).toBe("image/webp");
    expect(out.size).toBeLessThanOrEqual(EVENT_DESCRIPTION_IMAGE.maxBytes);
    expect(calls[0]).toEqual(["image/webp", 2048, 0.85]);
    expect(calls.at(-1)?.[1]).toBe(1536);
  });

  it("WebP を書き出せないブラウザでは JPEG", async () => {
    stubImage(800, 600);
    stubCanvas((mime) => blobOf(mime === "image/webp" ? "image/png" : mime, 1000));
    const out = await resizeForDescription(new Blob(["x"]));
    expect(out.type).toBe("image/jpeg");
  });
});
