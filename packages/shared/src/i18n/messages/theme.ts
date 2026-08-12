/**
 * 見た目のテーマの呼び名 (#362)。
 *
 * **言語の呼び名 (`LANGUAGE_NAMES`) とは扱いが違う**。あちらは「その言語を読む人が
 * 自分の言語を探すもの」なので綴りをそのまま保つが、テーマ名は**意味が伝わることに
 * 価値がある**ので訳す（見た目が想像できる言い方にする）。
 *
 * キーは `apps/web/src/theme/themes.ts` の `THEMES` のキー。テーマは足せるので
 * 画面側は `tDynamic` から引く（辞書に無いキーはキー名がそのまま出る）。
 */
const ja = {
  natsumatsuri: "夏祭り",
  neon: "ネオン",
  sakura: "桜",
  cool: "クール",
} as const;

const en: Record<keyof typeof ja, string> = {
  natsumatsuri: "Summer Festival",
  neon: "Neon",
  sakura: "Cherry Blossom",
  cool: "Cool",
};

export const themeName = { ja, en };
