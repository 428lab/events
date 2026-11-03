import { DECK_W, DECK_H, type DeckContent, type DeckElement } from "./decks.js";
import { DECK_IMPORT_LIMITS, type DeckImportFont, type DeckImportV2 } from "./deckImport.js";

/** スライドの書き出し（JSON）。公開の取り込み形式 events-lab-deck version 2 にする
 * （docs/slide-editor.md「4.1 書き出し」）。`/decks/import` にそのまま取り込み直せる。
 *
 * 取り込み（convertDeckImport）の逆。v2 が持たないもの（回転・グループ・位置キー pos・
 * 既定以外の書体）は落とす。位置と大きさは v2 の範囲に丸めて収める。 */

const COLOR = /^#[0-9A-Fa-f]{6}$/;
const BOX = { x: [0, DECK_W - 20], y: [0, DECK_H - 20], w: [20, DECK_W], h: [20, DECK_H] } as const;
const clamp = (v: number | undefined, min: number, max: number, fallback: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v! : fallback)));
const color = (v: string | undefined, fallback: string) => (v && COLOR.test(v) ? v : fallback);

function box(el: DeckElement) {
  const x = clamp(el.x, BOX.x[0], BOX.x[1], 0);
  const y = clamp(el.y, BOX.y[0], BOX.y[1], 0);
  return { x, y, w: clamp(el.w, BOX.w[0], DECK_W - x, BOX.w[0]), h: clamp(el.h, BOX.h[0], DECK_H - y, BOX.h[0]) };
}

function font(family: string | undefined): DeckImportFont {
  return family === "serif" || family === "monospace" ? family : "default";
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

export function exportDeckV2(deck: { title: string; content: DeckContent }, origin: string): DeckImportV2 {
  const title = deck.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, DECK_IMPORT_LIMITS.title).trim() || "Untitled";
  const slides = (deck.content.slides.length ? deck.content.slides : [{ background: "#ffffff", elements: [] }])
    .slice(0, DECK_IMPORT_LIMITS.slides)
    .map((slide) => ({
      background: color(slide.background, "#FFFFFF"),
      elements: slide.elements.slice(0, DECK_IMPORT_LIMITS.elementsPerSlide).flatMap((el): DeckImportV2["slides"][number]["elements"] => {
        const b = box(el);
        if (el.type === "image") {
          const src = imageSrc(el.src, origin);
          return [src ? { type: "image-url", ...b, src } : { type: "image-placeholder", ...b }];
        }
        const text = (el.text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, DECK_IMPORT_LIMITS.text);
        // 空の文字要素は v2 に書けない（1 文字以上）。描いても何も見えないので落とす
        if (!text) return [];
        return [{
          type: "text", ...b, text,
          fontSize: clamp(el.fontSize, 12, 160, 28), font: font(el.fontFamily),
          color: color(el.color, "#0F172A"), bold: Boolean(el.bold), italic: Boolean(el.italic),
          align: el.align ?? "left",
        }];
      }),
    }));
  return { format: "events-lab-deck", version: 2, title, slides };
}
