import { useTranslation } from "react-i18next";
import { FONTS } from "./imageTemplates.js";
import type { DeckContent } from "@eventer/shared";

/** 組み込みフォントの呼び名。**訳した文字列ではなくキーを持つ**ので、
 * 言語を切り替えたときに前の言語のまま残らない (#367) */
type BuiltinFontKey =
  | "studio.fontDefault"
  | "studio.fontSerif"
  | "studio.fontMono";

/** 選択肢の並び。**外から引くのは `useDeckFontOptions()` だけ**なので export しない
 * （呼ぶ側に「組み込みは辞書、欧文フォント名はそのまま」の三項を書かせない） */
type DeckFontOption = {
  /** CSS font-family。空文字＝既定（テーマのゴシック）。選択肢の値と key を兼ねる */
  family: string;
} & (
  | { labelKey: BuiltinFontKey; label?: undefined }
  /** 欧文のフォント名（Noto Sans など）は訳さないのでそのまま出す */
  | { label: string; labelKey?: undefined }
);

const DECK_FONTS: DeckFontOption[] = [
  { labelKey: "studio.fontDefault", family: "" },
  { labelKey: "studio.fontSerif", family: "serif" },
  { labelKey: "studio.fontMono", family: "monospace" },
  ...FONTS.map((f) => ({ label: f.label, family: f.family })),
];

/**
 * フォント選択欄に出す選択肢 (#367)。
 *
 * 「組み込みは辞書から引き、欧文フォント名はそのまま出す」という決まりを
 * **ここ1か所**に置く。スライドと配信の編集画面が同じものを引くので、
 * 呼ぶ側に同じ三項を2つ書かない。`family` は選択肢の値と React の key を兼ねる
 * （組み込みの3つも Google の各フォントも重複しない）。
 */
export function useDeckFontOptions(): Array<{ family: string; label: string }> {
  const { t } = useTranslation();
  return DECK_FONTS.map((f) => ({
    family: f.family,
    label: f.labelKey ? t(f.labelKey) : f.label,
  }));
}

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
