import type { Deck, DeckSlide } from "@eventer/shared";
import { api } from "../../api/client.js";
import { uploadDeckImage } from "../../api/deckHooks.js";
import { editableTextElements, pdfPagesToImport, pdfSlide, type PdfImportMode } from "./pdfSlides.js";
import type { PdfDocumentAdapter } from "./pdfPages.js";

/**
 * PDF の取り込み（docs/slide-editor.md「PDF から取り込む」）。
 *
 * 流れはエディタで1から作るのと同じ道を通る（取り込み専用の保存口は作らない）:
 * 1. 空のデッキを作る（POST /decks）
 * 2. ページごとに画像を描いて、そのデッキの画像として上げる（PUT /decks/:id/images）
 * 3. 中身を1回で保存する（PATCH /decks/:id、作った版を添える）
 * 途中で失敗したら、作りかけのデッキを消す（半端なデッキを一覧に残さない）。
 */

export type PdfImportStage = "render" | "upload" | "save";

export interface PdfImportProgress {
  /** いま処理しているページ（1 から）。保存中は total */
  page: number;
  total: number;
  stage: PdfImportStage;
}

export interface PdfImportResult {
  deck: Deck;
  /** 文字を直せる形で取り込めず、見た目そのままにしたページ（1 から） */
  imagePages: number[];
}

export class PdfImportError extends Error {
  constructor(
    public stage: PdfImportStage,
    /** 失敗したページ（1 から）。保存のときは null */
    public page: number | null,
    cause?: unknown,
  ) {
    super(`pdf_import_${stage}`);
    this.cause = cause;
  }
}

export interface PdfImportOptions {
  pdf: PdfDocumentAdapter;
  title: string;
  mode: PdfImportMode;
  onProgress?: (p: PdfImportProgress) => void;
  /** 取り消されたら true を返す。ページの合間で確かめる */
  cancelled?: () => boolean;
}

export async function importPdf({ pdf, title, mode, onProgress, cancelled }: PdfImportOptions): Promise<PdfImportResult | null> {
  const total = pdfPagesToImport(pdf.pageCount);
  const deck = await api.post<Deck>("/decks", { title });
  const slides: DeckSlide[] = [];
  const imagePages: number[] = [];
  try {
    for (let i = 0; i < total; i++) {
      if (cancelled?.()) {
        await discard(deck.id);
        return null;
      }
      onProgress?.({ page: i + 1, total, stage: "render" });
      let page;
      try {
        page = await pdf.renderPage(i, mode === "editable");
      } catch (error) {
        throw new PdfImportError("render", i + 1, error);
      }
      const texts = mode === "editable" && page.runs ? editableTextElements(page.runs) : null;
      // 文字を直せる形にできないページ（斜めの文字・要素が多すぎる）は、文字も入った全体の画像にする
      const image = mode === "editable" && !texts && page.full ? await page.full() : page.image;
      if (mode === "editable" && !texts) imagePages.push(i + 1);
      onProgress?.({ page: i + 1, total, stage: "upload" });
      let url: string;
      try {
        url = (await uploadDeckImage(deck.id, image)).url;
      } catch (error) {
        throw new PdfImportError("upload", i + 1, error);
      }
      slides.push(pdfSlide(url, texts ?? []));
    }
    onProgress?.({ page: total, total, stage: "save" });
    try {
      const saved = await api.patch<Deck>(`/decks/${deck.id}`, { content: { slides }, baseRevision: deck.revision ?? 0 });
      return { deck: saved, imagePages };
    } catch (error) {
      throw new PdfImportError("save", null, error);
    }
  } catch (error) {
    await discard(deck.id);
    throw error;
  }
}

/** 作りかけのデッキを消す。消せなくても元の失敗を伝える（一覧に空のデッキが残るだけ） */
async function discard(deckId: string) {
  await api.del(`/decks/${deckId}`).catch(() => undefined);
}
