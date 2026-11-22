import { DECK_H, DECK_IMPORT_LIMITS, DECK_W, type DeckElement, type DeckSlide } from "@eventer/shared";
import { uid } from "../editor/uid.js";

/**
 * PDF からスライドを組み立てる純粋な式（docs/slide-editor.md「PDF から取り込む」）。
 *
 * pdf.js には依存しない。pdf.js から取り出した文字の並び（`PdfTextRun`）を受け取り、
 * スライドの要素にする。pdf.js を使う側は `pdfPages.ts`（アダプタ）にある。
 */

/** 取り込む形。オーナー決定 2026-11-20（案 C、既定は見た目そのまま） */
export type PdfImportMode = "image" | "editable";

/** 1つのページから取り出した文字の切れ端。座標はスライドの 960×540 に換算済み（左上が原点） */
export interface PdfTextRun {
  text: string;
  /** 文字の左端 */
  x: number;
  /** 文字のベースライン */
  baseline: number;
  /** 文字の幅 */
  width: number;
  /** 文字の大きさ（スライドの px） */
  fontSize: number;
  /** pdf.js が分かった範囲での書体の種類 */
  font: "default" | "serif" | "monospace";
  bold: boolean;
  italic: boolean;
  /** `#rrggbb`。分からなければ null（既定の色） */
  color: string | null;
}

/**
 * 康熙部首・部首補助（「⽉」U+2F49 など）を普通の漢字に戻す。日本語の PDF は、見た目が同じ部首の文字で
 * 書き出されることがあり、そのままだと検索も編集もしにくい。ほかの文字（全角英数・括弧）は変えない
 */
export const normalizeRadicals = (text: string) =>
  text.replace(/[\u2E80-\u2EFF\u2F00-\u2FDF]/g, (c) => c.normalize("NFKC"));

/** 書体の名前から3つの書体のどれかを決める。pdf.js の isMonospace は和文（全角が同じ幅）でも立つので使わない */
export function pdfFontKind(name: string, family: string, isSerifFont: boolean | undefined): PdfTextRun["font"] {
  const plain = name.replace(/^[A-Z]{6}\+/, "");
  if (/mono|courier|menlo|consol|code|等幅/i.test(plain)) return "monospace";
  if (isSerifFont || /mincho|min(pro|std)|serif|明朝|times|georgia|garamond/i.test(plain) || (!plain && family === "serif")) return "serif";
  return "default";
}

/** 文字の高さに対する、行の上端の位置（ベースラインからの上がり） */
const ASCENT = 0.85;
/** 編集画面の行の高さ（SlideStage の lineHeight 1.3） */
const LINE_HEIGHT = 1.3;
/** 1つのスライドに置ける要素の数（公開の取り込み形式と同じ上限）。背景の画像に1つ使う */
export const PDF_MAX_TEXT_ELEMENTS = DECK_IMPORT_LIMITS.elementsPerSlide - 1;
/** 1つの文字要素の文字数の上限（公開の取り込み形式と同じ） */
const MAX_TEXT = DECK_IMPORT_LIMITS.text;

interface Line {
  runs: PdfTextRun[];
  x: number;
  right: number;
  baseline: number;
  fontSize: number;
}

/** 色が近いか。色は描いた画像から拾うので、文字の縁のにじみで少しずれる（#dc2626 と #de3030 など） */
function nearColor(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return x.every((v, i) => Math.abs(v - y[i]!) <= 24);
}

/** 同じ書式か（書式が違う文字は別の要素にする。要素は書式を1つしか持てない） */
const sameStyle = (a: PdfTextRun, b: PdfTextRun) =>
  a.font === b.font && a.bold === b.bold && a.italic === b.italic && nearColor(a.color, b.color) &&
  Math.abs(a.fontSize - b.fontSize) <= Math.max(1, a.fontSize * 0.15);

/** 1行にまとめる。ベースラインがそろっていて、すぐ隣にある同じ書式の切れ端をつなぐ */
export function groupLines(runs: readonly PdfTextRun[]): Line[] {
  const sorted = runs.filter((r) => r.text.trim() !== "").slice()
    .sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines: Line[] = [];
  for (const run of sorted) {
    const line = lines.find((l) => {
      const last = l.runs[l.runs.length - 1]!;
      const gap = run.x - l.right;
      return Math.abs(l.baseline - run.baseline) <= run.fontSize * 0.3 && sameStyle(last, run) &&
        gap > -run.fontSize * 0.5 && gap < run.fontSize * 1.5;
    });
    if (line) {
      line.runs.push(run);
      line.right = Math.max(line.right, run.x + run.width);
    } else {
      lines.push({ runs: [run], x: run.x, right: run.x + run.width, baseline: run.baseline, fontSize: run.fontSize });
    }
  }
  return lines;
}

/** 行の文字。切れ端のあいだが空いていれば空白を入れる（英文の単語の区切り） */
function lineText(line: Line): string {
  let out = "";
  let end: number | null = null;
  for (const run of line.runs) {
    if (end !== null && run.x - end > run.fontSize * 0.2 && !out.endsWith(" ") && !run.text.startsWith(" ")) out += " ";
    out += run.text;
    end = run.x + run.width;
  }
  return out.trimEnd();
}

interface Block {
  lines: Line[];
  style: PdfTextRun;
  x: number;
  right: number;
  top: number;
  bottom: number;
}

/** 段落にまとめる。左端がそろい、行の間が詰まっている同じ書式の行を1つの文字要素にする */
export function groupBlocks(lines: readonly Line[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const style = line.runs[0]!;
    const top = line.baseline - line.fontSize * ASCENT;
    const prev = blocks.find((b) => {
      const last = b.lines[b.lines.length - 1]!;
      const step = line.baseline - last.baseline;
      return sameStyle(b.style, style) && Math.abs(b.x - line.x) <= line.fontSize * 1.5 &&
        step > 0 && step <= line.fontSize * 1.8;
    });
    if (prev) {
      prev.lines.push(line);
      prev.x = Math.min(prev.x, line.x);
      prev.right = Math.max(prev.right, line.right);
      prev.bottom = line.baseline + line.fontSize * (LINE_HEIGHT - ASCENT);
    } else {
      blocks.push({ lines: [line], style, x: line.x, right: line.right, top, bottom: line.baseline + line.fontSize * (LINE_HEIGHT - ASCENT) });
    }
  }
  return blocks;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 段落を文字の要素にする。枠は行の高さ 1.3 で文字が収まる大きさ。スライドの外にははみ出さない */
function blockElement(block: Block): DeckElement {
  const { style } = block;
  const fontSize = Math.max(6, Math.round(style.fontSize));
  const text = block.lines.map(lineText).join("\n").slice(0, MAX_TEXT);
  // 文字の幅は書体が変わると少し広がるので、1割の余白を持たせる
  const x = clamp(Math.round(block.x), 0, DECK_W - 20);
  const y = clamp(Math.round(block.top - fontSize * (LINE_HEIGHT - 1) / 2), 0, DECK_H - 20);
  const w = clamp(Math.ceil((block.right - block.x) * 1.1) + 4, 20, DECK_W - x);
  const h = clamp(Math.ceil(block.lines.length * fontSize * LINE_HEIGHT) + 2, 20, DECK_H - y);
  return {
    id: uid(),
    type: "text",
    x, y, w, h,
    rotation: 0,
    text,
    fontSize,
    fontFamily: style.font === "default" ? "" : style.font,
    color: style.color ?? "#0f172a",
    bold: style.bold || undefined,
    italic: style.italic || undefined,
    align: "left",
  };
}

/** 全面の画像（ページそのもの、または文字を抜いた背景） */
export function fullBleedImage(src: string): DeckElement {
  return { id: uid(), type: "image", x: 0, y: 0, w: DECK_W, h: DECK_H, rotation: 0, src };
}

/**
 * 文字を直せる形のページの文字要素。要素が多すぎるとき（1枚 49 個まで）は null を返す。
 * そのページは見た目そのまま（画像1枚）で取り込む。
 */
export function editableTextElements(runs: readonly PdfTextRun[]): DeckElement[] | null {
  const blocks = groupBlocks(groupLines(runs));
  if (blocks.length > PDF_MAX_TEXT_ELEMENTS) return null;
  return blocks.map(blockElement).filter((el) => (el.text ?? "").trim() !== "");
}

/** ページを1枚のスライドにする。背景の画像を一番奥に置き、その上に文字を重ねる */
export function pdfSlide(imageSrc: string, texts: readonly DeckElement[] = []): DeckSlide {
  return { id: uid(), background: "#ffffff", elements: [fullBleedImage(imageSrc), ...texts] };
}

/** 取り込むページ数。上限（60）を超える分は取り込まない */
export const PDF_MAX_PAGES = DECK_IMPORT_LIMITS.slides;
export const pdfPagesToImport = (pageCount: number) => Math.min(pageCount, PDF_MAX_PAGES);
