import { FONTS } from "./imageTemplates.js";
import type { DeckContent } from "@eventer/shared";

export interface DeckFontOption {
  label: string;
  /** CSS font-family。空文字＝既定（テーマのゴシック） */
  family: string;
  /** Google Fonts からオンデマンド読込するか */
  google: boolean;
}

export const DECK_FONTS: DeckFontOption[] = [
  { label: "標準ゴシック", family: "", google: false },
  { label: "明朝（システム）", family: "serif", google: false },
  { label: "等幅", family: "monospace", google: false },
  ...FONTS.map((f) => ({ label: f.label, family: f.family, google: true })),
];

const loaded = new Set<string>();

/** Google Fonts を必要時に読み込む（フルウェイト。スライド本文は任意の文字を含むため text 部分集合は使わない） */
export function ensureDeckFont(family?: string): void {
  if (!family || family === "serif" || family === "monospace") return;
  if (loaded.has(family)) return;
  loaded.add(family);
  const href = `https://fonts.googleapis.com/css2?family=${family.replace(
    / /g,
    "+",
  )}&display=swap`;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** デッキ内で使われている全フォントを読み込む */
export function ensureDeckFonts(content: DeckContent): void {
  for (const s of content.slides) {
    for (const e of s.elements) ensureDeckFont(e.fontFamily);
  }
}
