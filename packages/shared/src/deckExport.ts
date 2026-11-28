import type { DeckContent } from "./decks.js";
import { DECK_IMPORT_FONTS, DECK_IMPORT_LIMITS, type DeckImportFont, type DeckImportV2 } from "./deckImport.js";

/** スライドの書き出し（JSON）。公開の取り込み形式 events-lab-deck version 2 にする
 * （docs/slide-editor.md「4.1 書き出し」）。`/decks/import` にそのまま取り込み直せる。
 *
 * 取り込み（convertDeckImport）の逆。編集画面が作れる中身はそのまま書く（位置・大きさは小数や
 * スライドの外も、回転・グループ・書体・装飾の有無も）。取り込み直すと同じ中身に戻る
 * （id と並びの位置キー pos は振り直す。並びの順は同じ）。AI に直してもらっても元の内容が
 * 変わらないようにするため（kojira 2026-11-28）。書けないのは上限を超えた分だけ（deckV2Losses）。 */

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const finite = (v: number | undefined, fallback: number) => (Number.isFinite(v) ? v! : fallback);
const color = (v: string | undefined, fallback: string) => (v && COLOR.test(v) ? v : fallback);

/** 編集画面の書体はそのまま書き出す。一覧に無い値（編集画面では作れない）だけ既定にする */
function font(family: string): DeckImportFont {
  return family !== "default" && (DECK_IMPORT_FONTS as readonly string[]).includes(family) ? family as DeckImportFont : "default";
}

/** 相対の画像（`/api/decks/...`）は表示中のオリジンで絶対 URL にする。HTTPS の絶対 URL に
 * ならないもの（ローカルの http など）は空枠にする */
function imageSrc(src: string | undefined, origin: string): string | null {
  if (!src) return null;
  try {
    const url = new URL(src, origin);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const abs = url.href;
    return abs.length <= 500 ? abs : null;
  } catch {
    return null;
  }
}

export interface ExportDeckV2Options {
  /** この関数が true を返す画像の src は、そのまま（相対のまま）書く。AI 用トークンの読み取りで、
   * そのデッキにアップロード済みの画像を PUT にそのまま戻せるようにするため（docs/agent-deck-token.md §4c） */
  keepSrc?: (src: string) => boolean;
}

export function exportDeckV2(deck: { title: string; content: DeckContent }, origin: string, options: ExportDeckV2Options = {}): DeckImportV2 {
  const title = deck.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, DECK_IMPORT_LIMITS.title).trim();
  const slides = (deck.content.slides.length ? deck.content.slides : [{ background: "#ffffff", elements: [] }])
    .slice(0, DECK_IMPORT_LIMITS.slides)
    .map((slide) => ({
      background: color(slide.background, "#FFFFFF"),
      elements: slide.elements.slice(0, DECK_IMPORT_LIMITS.elementsPerSlide).map((el): DeckImportV2["slides"][number]["elements"][number] => {
        const b = {
          x: finite(el.x, 0), y: finite(el.y, 0), w: Math.max(0, finite(el.w, 0)), h: Math.max(0, finite(el.h, 0)),
          ...(el.rotation ? { rotation: el.rotation } : {}),
          ...(el.groupId ? { group: el.groupId } : {}),
        };
        if (el.type === "image") {
          const src = el.src && options.keepSrc?.(el.src) ? el.src : imageSrc(el.src, origin);
          return src ? { type: "image-url", ...b, src } : { type: "image-placeholder", ...b };
        }
        return {
          type: "text", ...b, text: el.text ?? "",
          ...(el.fontSize !== undefined && Number.isFinite(el.fontSize) ? { fontSize: Math.max(0, el.fontSize) } : {}),
          ...(el.fontFamily !== undefined ? { font: el.fontFamily ? font(el.fontFamily) : "default" } : {}),
          ...(el.color !== undefined ? { color: color(el.color, "#0F172A") } : {}),
          ...(el.bold !== undefined ? { bold: el.bold } : {}),
          ...(el.italic !== undefined ? { italic: el.italic } : {}),
          ...(el.align !== undefined ? { align: el.align } : {}),
        };
      }),
    }));
  return { format: "events-lab-deck", version: 2, title, slides };
}

/** v2 に書き出せない分（exportDeckV2 と取り込みの検証と同じ上限）。AI に直してもらう前に確かめる
 * （docs/agent-deck-token.md §4c）。1 以上なら、書き出しで切り捨てられるか書き戻しが通らないので AI では直せない。
 * それ以外の中身（回転・グループ・書体・装飾・はみ出した位置）は v2 でそのまま運べる */
export interface DeckV2Losses {
  truncatedSlides: number;
  truncatedElements: number;
  /** 全スライド合計の要素数・文字数の上限を超えた分 */
  overTotalElements: number;
  overTotalText: number;
}

export function deckV2Losses(content: DeckContent): DeckV2Losses {
  const slides = content.slides.slice(0, DECK_IMPORT_LIMITS.slides);
  const truncatedSlides = Math.max(0, content.slides.length - DECK_IMPORT_LIMITS.slides);
  let truncatedElements = 0, elements = 0, text = 0;
  for (const slide of slides) {
    truncatedElements += Math.max(0, slide.elements.length - DECK_IMPORT_LIMITS.elementsPerSlide);
    for (const el of slide.elements.slice(0, DECK_IMPORT_LIMITS.elementsPerSlide)) {
      elements++;
      if (el.type === "text") text += (el.text ?? "").length;
    }
  }
  return {
    truncatedSlides, truncatedElements,
    overTotalElements: Math.max(0, elements - DECK_IMPORT_LIMITS.elements),
    overTotalText: Math.max(0, text - DECK_IMPORT_LIMITS.totalText),
  };
}

/** AI では直せない大きさか（v2 の上限を超える） */
export const deckTooLargeForAi = (l: DeckV2Losses) =>
  l.truncatedSlides > 0 || l.truncatedElements > 0 || l.overTotalElements > 0 || l.overTotalText > 0;
