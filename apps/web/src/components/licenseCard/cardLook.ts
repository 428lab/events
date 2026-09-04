import { BG_VARIANTS, CARD_THEMES } from "./cardTheme.js";
import type { CardBgVariant, CardThemeKey } from "./cardTheme.js";

/**
 * カードの見た目（背景×配色）の決め方を1か所に置く (#334)。
 *
 * カードは「持ち主の意匠」で描くものなので、誰が見ても同じ絵になる。
 * 見る人の端末に保存された既定は、持ち主がまだ一度も決めていないときだけ借りる。
 * この判断を画面ごとに書くと、片方だけ直し忘れて「他人のカードが自分の色で出る」
 * ことになるため、契約（保存キー・既定・"背景-配色" の分解）はここにまとめる。
 */

export interface CardLook {
  variant: CardBgVariant;
  theme: CardThemeKey;
}

/** 手元（この端末）で選んだ既定の保存先。持ち主の値が無いときだけ使う */
export const BG_STORAGE_KEY = "eventer:cardBg";
export const THEME_STORAGE_KEY = "eventer:cardTheme";

/** 何も選んでいないときの見た目（type-T1.svg 本来の配色） */
export const DEFAULT_CARD_LOOK: CardLook = {
  variant: "rosette",
  theme: "indigo",
};

/** サーバーに記録する組み合わせキー（"背景-配色"） */
export function cardLookKey(look: CardLook): string {
  return `${look.variant}-${look.theme}`;
}

/** この端末で選んだ既定を読む。読めない値・未選択は既定にそろえる */
export function loadLocalCardLook(): CardLook {
  const bg = localStorage.getItem(BG_STORAGE_KEY);
  const color = localStorage.getItem(THEME_STORAGE_KEY);
  return {
    variant: BG_VARIANTS.some((v) => v.key === bg)
      ? (bg as CardBgVariant)
      : DEFAULT_CARD_LOOK.variant,
    theme: CARD_THEMES.some((t) => t.key === color)
      ? (color as CardThemeKey)
      : DEFAULT_CARD_LOOK.theme,
  };
}

/** この端末の既定として覚える。**自分のカードを編集したときだけ**呼ぶこと。
 * 他人のカードを見ただけで書き換えると、自分の既定がすり替わる */
export function saveLocalCardLook(look: CardLook): void {
  localStorage.setItem(BG_STORAGE_KEY, look.variant);
  localStorage.setItem(THEME_STORAGE_KEY, look.theme);
}

/** 持ち主が決めた見た目 (#304, #334)。
 *
 * 持ち主がカードを保存すると "背景-配色" がサーバーに記録される（OG画像の配信でも
 * 同じ値を使う）。プロフィール上のカードも名札の印刷もこれに従う。
 * 一度も保存していない人は値が無いので、見ている人の手元の既定を借りる */
export function cardLook(
  key: string | null | undefined,
  fallback: CardLook = loadLocalCardLook(),
): CardLook {
  const [bg, color] = (key ?? "").split("-");
  return {
    variant: BG_VARIANTS.some((v) => v.key === bg)
      ? (bg as CardBgVariant)
      : fallback.variant,
    theme: CARD_THEMES.some((t) => t.key === color)
      ? (color as CardThemeKey)
      : fallback.theme,
  };
}
