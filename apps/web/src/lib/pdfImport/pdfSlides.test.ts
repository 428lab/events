import { describe, expect, it } from "vitest";
import { editableTextElements, groupLines, normalizeRadicals, PDF_MAX_TEXT_ELEMENTS, pdfFontKind, pdfSlide, type PdfTextRun } from "./pdfSlides.js";

/** PDF の文字の切れ端（スライドの px）。既定は 24px のふつうの書体・黒 */
const run = (text: string, x: number, baseline: number, over: Partial<PdfTextRun> = {}): PdfTextRun => ({
  text, x, baseline, width: text.length * 12, fontSize: 24, font: "default", bold: false, italic: false, color: "#111111", ...over,
});

describe("PDF の文字を文字の箱にする（文字を直せる形）", () => {
  it("同じ行の切れ端は1行に、左端がそろった続きの行は1つの箱にまとめる。書式が違えば分ける", () => {
    const els = editableTextElements([
      // 見出し（大きい・太字）
      run("Events", 60, 80, { fontSize: 48, bold: true, width: 150 }),
      run("lab", 220, 80, { fontSize: 48, bold: true, width: 80 }),
      // 本文の段落（2行。切れ端が細かく分かれている）
      run("PDFから", 60, 200), run("取り込む", 120, 200),
      run("2行目です", 60, 232),
      // 離れた場所の注記（明朝）
      run("注記", 700, 500, { font: "serif", fontSize: 16, color: "#ff0000" }),
      // 色を画像から拾うので少しずれる。近い色は同じ行につなぐ
      run("です", 724, 500, { font: "serif", fontSize: 16, color: "#f01010" }),
    ])!;
    expect(els.map((e) => e.text)).toEqual(["Events lab", "PDFから取り込む\n2行目です", "注記です"]);
    expect(els[0]).toMatchObject({ fontSize: 48, bold: true, fontFamily: "" });
    expect(els[2]).toMatchObject({ fontFamily: "serif", color: "#ff0000", fontSize: 16 });
    // 枠はスライドの中に収まる
    for (const e of els) {
      expect(e.x + e.w).toBeLessThanOrEqual(960);
      expect(e.y + e.h).toBeLessThanOrEqual(540);
    }
  });

  it("行の間が空いていれば別の箱、同じ行でも離れていれば別の行", () => {
    const lines = groupLines([run("左", 60, 100), run("右", 700, 100)]);
    expect(lines).toHaveLength(2);
    const els = editableTextElements([run("上", 60, 100), run("下", 60, 300)])!;
    expect(els.map((e) => e.text)).toEqual(["上", "下"]);
  });

  it("箱が多すぎるページは null（そのページは見た目そのまま）。背景の画像は一番奥", () => {
    const many = Array.from({ length: PDF_MAX_TEXT_ELEMENTS + 1 }, (_, i) => run(`${i}`, (i % 7) * 130, 30 + Math.floor(i / 7) * 70));
    expect(editableTextElements(many)).toBeNull();
    const slide = pdfSlide("/api/decks/d/images/i", editableTextElements([run("a", 10, 40)])!);
    expect(slide.elements[0]).toMatchObject({ type: "image", x: 0, y: 0, w: 960, h: 540, src: "/api/decks/d/images/i" });
    expect(slide.elements[1]).toMatchObject({ type: "text", text: "a" });
  });
});

describe("書体と文字の手直し", () => {
  it("書体は名前で決める（和文のゴシックは等幅にしない）。部首の文字は普通の漢字に戻す", () => {
    expect(pdfFontKind("BAAAAA+HiraginoSans-W4", "monospace", false)).toBe("default");
    expect(pdfFontKind("CAAAAA+HiraMinProN-W3", "serif", true)).toBe("serif");
    expect(pdfFontKind("DAAAAA+Menlo-Regular", "monospace", false)).toBe("monospace");
    expect(normalizeRadicals("2026年11⽉・当⽇")).toBe("2026年11月・当日");
    expect(normalizeRadicals("ＡＢＣ（全角）")).toBe("ＡＢＣ（全角）");
  });
});
