import { DECK_H, DECK_W } from "@eventer/shared";
import {
  getDocument,
  GlobalWorkerOptions,
  OPS,
  PasswordException,
  Util,
  version,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, TextStyle } from "pdfjs-dist/types/src/display/api.js";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { normalizeRadicals, pdfFontKind, type PdfTextRun } from "./pdfSlides.js";

/**
 * pdf.js のアダプタ（docs/slide-editor.md「PDF から取り込む」）。
 *
 * pdf.js を触るのはこのファイルだけ。取り込みの画面からは動的 import で読むので、
 * ほかの画面のバンドルには入らない。古い iOS Safari でも動くよう legacy 版を使う。
 * CMap・標準フォント・wasm は vite の `pdfjsAssets` プラグインが `/pdfjs/<版>/` に置く
 * （日本語の PDF は CMap が無いと文字が取れない）。
 */

GlobalWorkerOptions.workerSrc = workerUrl;
const assetBase = () => new URL(`/pdfjs/${version}/`, location.origin).href;

/** スライドの画像の大きさ（960×540 の2倍。プロジェクターに映しても粗くならない） */
const RENDER_SCALE = 2;
const RENDER_W = DECK_W * RENDER_SCALE;
const RENDER_H = DECK_H * RENDER_SCALE;
/** スライド画像の上限（サーバーの deckImages と同じ 6MB）。少し余裕を見る */
const IMAGE_MAX_BYTES = 5.5 * 1024 * 1024;
/** 文字を描く命令。文字を直せる形の背景は、これを飛ばして描く */
const TEXT_OPS = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);

export class PdfOpenError extends Error {
  constructor(public code: "password" | "invalid") {
    super(code);
  }
}

/** 1ページを描いた結果 */
export interface RenderedPdfPage {
  /** 見た目そのままでは全体、文字を直せる形では文字を抜いた背景 */
  image: Blob;
  /** 文字を直せる形のときだけ。null は文字を取り出せない（斜め・縦書き）ページ */
  runs?: PdfTextRun[] | null;
  /** 文字も入った全体の画像。文字を直せる形で、そのページを見た目そのままに戻すときに使う */
  full?: () => Promise<Blob>;
}

export interface PdfDocumentAdapter {
  pageCount: number;
  /** PDF の情報にある題名（無ければ null） */
  title: string | null;
  renderPage(index: number, editable: boolean): Promise<RenderedPdfPage>;
  destroy(): void;
}

export async function openPdf(file: Blob): Promise<PdfDocumentAdapter> {
  const base = assetBase();
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    // 書体の太字・明朝・等幅の手がかり（name / isSerifFont / isMonospace）を受け取る
    fontExtraProperties: true,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    void task.destroy();
    throw new PdfOpenError(error instanceof PasswordException ? "password" : "invalid");
  }
  const info = await doc.getMetadata().then((m) => (m.info as { Title?: unknown } | undefined)?.Title).catch(() => null);
  return {
    pageCount: doc.numPages,
    title: typeof info === "string" && info.trim() ? info.trim() : null,
    renderPage: (index, editable) => renderPage(doc, index, editable),
    destroy: () => void task.destroy(),
  };
}

async function renderPage(doc: PDFDocumentProxy, index: number, editable: boolean): Promise<RenderedPdfPage> {
  const page = await doc.getPage(index + 1);
  try {
    const full = await draw(page, false);
    if (!editable) return { image: await encode(full.canvas) };
    const background = await draw(page, true);
    const runs = await textRuns(page, full, background);
    return { image: await encode(background.canvas), runs, full: () => encode(full.canvas) };
  } finally {
    page.cleanup();
  }
}

interface Drawn {
  canvas: HTMLCanvasElement;
  /** PDF の座標 → 描いた画像の px */
  transform: number[];
  /** PDF の単位 → 描いた画像の px */
  scale: number;
  /** 画像の px → スライドの px */
  toSlide: number;
}

/** 16:9 の白い画像の真ん中に、縦横比を保ってページを描く（スライドの背景にそのまま敷ける） */
async function draw(page: PDFPageProxy, withoutText: boolean): Promise<Drawn> {
  const unit = page.getViewport({ scale: 1 });
  const scale = Math.min(RENDER_W / unit.width, RENDER_H / unit.height);
  const viewport = page.getViewport({
    scale,
    offsetX: (RENDER_W - unit.width * scale) / 2,
    offsetY: (RENDER_H - unit.height * scale) / 2,
  });
  const canvas = document.createElement("canvas");
  canvas.width = RENDER_W;
  canvas.height = RENDER_H;
  await page.render({
    canvas,
    viewport,
    background: "#ffffff",
    operationsFilter: withoutText ? (i, list) => !TEXT_OPS.has(list.fnArray[i]!) : undefined,
  }).promise;
  return { canvas, transform: viewport.transform, scale, toSlide: 1 / RENDER_SCALE };
}

/** 画像にする。WebP が作れない端末（Safari など）は JPEG。6MB に収まるまで画質を下げる */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const [type, quality] of [["image/webp", 0.85], ["image/jpeg", 0.85], ["image/jpeg", 0.6], ["image/jpeg", 0.4]] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (blob && blob.type === type && blob.size <= IMAGE_MAX_BYTES) return blob;
  }
  throw new Error("encode_failed");
}

interface FontInfo {
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  name?: string;
  isSerifFont?: boolean;
}

/** 文字の切れ端を取り出す。斜め・縦書きの文字があれば null（そのページは見た目そのまま） */
async function textRuns(page: PDFPageProxy, full: Drawn, background: Drawn): Promise<PdfTextRun[] | null> {
  const content = await page.getTextContent();
  const fullPixels = pixels(full.canvas);
  const backPixels = pixels(background.canvas);
  const runs: PdfTextRun[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const style: TextStyle | undefined = content.styles[item.fontName];
    const m = Util.transform(full.transform, item.transform);
    // 横書きの、傾いていない文字だけを文字の箱にできる
    if (style?.vertical || item.dir === "ttb" || Math.abs(m[1]) > Math.abs(m[0]) * 0.02 || Math.abs(m[2]) > Math.abs(m[3]) * 0.02) return null;
    const run = toRun(item, m, style, fontInfo(page, item.fontName), full);
    const color = sampleColor(fullPixels, backPixels, run, full.toSlide);
    // 描いても見えない文字（スキャンした PDF の検索用の文字など）は、背景の絵に字があるので重ねない
    if (color === undefined) continue;
    runs.push({ ...run, color });
  }
  return runs;
}

function fontInfo(page: PDFPageProxy, fontName: string): FontInfo {
  try {
    return page.commonObjs.has(fontName) ? (page.commonObjs.get(fontName) as FontInfo) : {};
  } catch {
    return {};
  }
}

function toRun(item: TextItem, m: number[], style: TextStyle | undefined, font: FontInfo, drawn: Drawn): PdfTextRun {
  const { toSlide } = drawn;
  const name = font.name ?? "";
  const fontSize = Math.hypot(m[2]!, m[3]!) * toSlide;
  return {
    text: normalizeRadicals(item.str),
    x: m[4]! * toSlide,
    baseline: m[5]! * toSlide,
    // item.width は PDF の単位
    width: item.width * drawn.scale * toSlide,
    fontSize,
    font: pdfFontKind(name, style?.fontFamily ?? "", font.isSerifFont),
    bold: Boolean(font.bold || font.black || /bold|black|heavy|semibold|-w[6-9]\b/i.test(name)),
    italic: Boolean(font.italic || /italic|oblique/i.test(name)),
    color: null,
  };
}

const pixels = (canvas: HTMLCanvasElement) =>
  canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);

/**
 * 文字の色。文字ありと文字なしの画像の違うところが文字なので、その色を取る。
 * 違いが無ければ見えない文字（undefined）。
 */
function sampleColor(full: ImageData, back: ImageData, run: PdfTextRun, toSlide: number): string | null | undefined {
  const k = 1 / toSlide;
  const x0 = Math.max(0, Math.floor(run.x * k)), x1 = Math.min(full.width - 1, Math.ceil((run.x + run.width) * k));
  const y0 = Math.max(0, Math.floor((run.baseline - run.fontSize * 0.9) * k)), y1 = Math.min(full.height - 1, Math.ceil((run.baseline + run.fontSize * 0.25) * k));
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 24));
  const hits: Array<[number, number, number, number]> = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const i = (y * full.width + x) * 4;
      const d = Math.abs(full.data[i]! - back.data[i]!) + Math.abs(full.data[i + 1]! - back.data[i + 1]!) + Math.abs(full.data[i + 2]! - back.data[i + 2]!);
      if (d > 48) hits.push([d, full.data[i]!, full.data[i + 1]!, full.data[i + 2]!]);
    }
  }
  if (hits.length === 0) return undefined;
  // 縁のにじんだ点を避け、違いの大きい上位の点の平均を取る
  hits.sort((a, b) => b[0] - a[0]);
  const top = hits.slice(0, Math.max(1, Math.ceil(hits.length / 3)));
  const avg = (j: 1 | 2 | 3) => Math.round(top.reduce((s, h) => s + h[j], 0) / top.length);
  return `#${[avg(1), avg(2), avg(3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
