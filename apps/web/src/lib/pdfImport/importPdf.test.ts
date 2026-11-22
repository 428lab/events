import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckContent } from "@eventer/shared";
import type { PdfDocumentAdapter, RenderedPdfPage } from "./pdfPages.js";
import type { PdfTextRun } from "./pdfSlides.js";

const mocks = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), del: vi.fn(), upload: vi.fn() }));
vi.mock("../../api/client.js", () => ({ api: { post: mocks.post, patch: mocks.patch, del: mocks.del } }));
vi.mock("../../api/deckHooks.js", () => ({ uploadDeckImage: mocks.upload }));
const { importPdf, PdfImportError } = await import("./importPdf.js");

const page = (over: Partial<RenderedPdfPage> = {}): RenderedPdfPage => ({ image: new Blob(["page"], { type: "image/webp" }), ...over });
const fakePdf = (pageCount: number, render: (i: number, editable: boolean) => RenderedPdfPage = () => page()): PdfDocumentAdapter => ({
  pageCount, title: null, destroy: vi.fn(), renderPage: vi.fn(async (i: number, editable: boolean) => render(i, editable)),
});
const run = (text: string, x: number, baseline: number): PdfTextRun =>
  ({ text, x, baseline, width: 60, fontSize: 24, font: "default", bold: false, italic: false, color: "#000000" });
const savedContent = () => (mocks.patch.mock.calls[0]![1] as { content: DeckContent }).content;

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.post.mockResolvedValue({ id: "d1", revision: 0 });
  mocks.patch.mockImplementation(async (_p: string, body: { content: DeckContent }) => ({ id: "d1", content: body.content }));
  mocks.del.mockResolvedValue({ ok: true });
  let n = 0;
  mocks.upload.mockImplementation(async () => ({ url: `/api/decks/d1/images/${++n}` }));
});

describe("PDF の取り込み（デッキを作る → 画像を上げる → 1回で保存）", () => {
  it("見た目そのまま: 1ページ＝画像1枚の全面スライド。最後に1回だけ、作った版を添えて保存する", async () => {
    const pdf = fakePdf(3);
    const result = await importPdf({ pdf, title: "発表", mode: "image" });
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith("/decks", { title: "発表" });
    expect(pdf.renderPage).toHaveBeenCalledTimes(3);
    expect(vi.mocked(pdf.renderPage).mock.calls.every(([, editable]) => editable === false)).toBe(true);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch.mock.calls[0]![1]).toMatchObject({ baseRevision: 0 });
    const { slides } = savedContent();
    expect(slides).toHaveLength(3);
    expect(slides.map((s) => s.elements)).toEqual([1, 2, 3].map((n) => [
      expect.objectContaining({ type: "image", x: 0, y: 0, w: 960, h: 540, src: `/api/decks/d1/images/${n}` }),
    ]));
    expect(result?.imagePages).toEqual([]);
  });

  it("文字を直せる形: 背景の画像の上に文字の箱。文字にできないページは全体の画像にして知らせる", async () => {
    const full = new Blob(["full"], { type: "image/webp" });
    const pdf = fakePdf(2, (i) => page({ runs: i === 0 ? [run("こんにちは", 60, 100)] : null, full: async () => full }));
    const result = await importPdf({ pdf, title: "t", mode: "editable" });
    const { slides } = savedContent();
    expect(slides[0]!.elements.map((e) => e.type)).toEqual(["image", "text"]);
    expect(slides[0]!.elements[1]).toMatchObject({ text: "こんにちは" });
    expect(slides[1]!.elements.map((e) => e.type)).toEqual(["image"]);
    expect(mocks.upload.mock.calls[1]![1]).toBe(full);
    expect(result?.imagePages).toEqual([2]);
  });

  it("60ページを超える PDF は最初の60ページだけ", async () => {
    const pdf = fakePdf(75);
    await importPdf({ pdf, title: "t", mode: "image" });
    expect(pdf.renderPage).toHaveBeenCalledTimes(60);
    expect(savedContent().slides).toHaveLength(60);
  });

  it("画像を上げられなかったら、そのページを伝えて作りかけのデッキを消す（保存しない）", async () => {
    mocks.upload.mockResolvedValueOnce({ url: "/api/decks/d1/images/1" }).mockRejectedValueOnce(new Error("upload_failed"));
    const error = await importPdf({ pdf: fakePdf(3), title: "t", mode: "image" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfImportError);
    expect(error).toMatchObject({ stage: "upload", page: 2 });
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith("/decks/d1");
  });
});
