/**
 * 対応言語と、その決め方 (#352)。
 *
 * ここは **画面・サーバー・メールで共通の1か所**。言語を足すときはここだけ触る。
 * ブラウザ API に依存させないため、判定はすべて「候補の並び」を受け取る純粋な
 * 関数にしてある（画面は URL とブラウザ設定を、サーバーは利用者の設定を渡す）。
 */

/** 対応言語。先頭が既定 */
export const SUPPORTED_LANGUAGES = ["ja", "en"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** 何も決まらなかったときの言語 */
export const DEFAULT_LANGUAGE: AppLanguage = "ja";

/**
 * 日時の書式に使うロケール。
 *
 * **タイムゾーンは端末のまま**（Intl に timeZone を渡さない）。切り替えるのは
 * 書式だけ。利用者ごとのタイムゾーン設定は作らない方針 (#352)。
 */
export const DATE_LOCALES: Record<AppLanguage, string> = {
  ja: "ja-JP",
  en: "en-US",
};

/**
 * 言語そのものの呼び名 (#354)。
 *
 * **どの言語で表示していても綴りは同じ**。選ぶのはその言語を読む人なので、
 * 「Japanese」ではなく「日本語」と出したほうが探しやすい。翻訳キーには置かない。
 */
export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  ja: "日本語",
  en: "English",
};

/** "en-US" や "JA" のような表記を対応言語に寄せる。対応外なら null */
export function normalizeLanguage(tag: string | null | undefined): AppLanguage | null {
  if (!tag) return null;
  const base = tag.toLowerCase().split("-")[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as AppLanguage)
    : null;
}

/**
 * 候補を先頭から見て、最初に対応できたものを返す。どれも対応外なら日本語。
 *
 * 呼ぶ側が優先順位を決める。画面では
 * `resolveLanguage([urlLang, userPref, ...navigator.languages])` の順で渡す
 * （URLの指定 > 利用者の設定 > ブラウザの言語 > 日本語）。
 */
export function resolveLanguage(
  candidates: readonly (string | null | undefined)[],
): AppLanguage {
  for (const c of candidates) {
    const lang = normalizeLanguage(c);
    if (lang) return lang;
  }
  return DEFAULT_LANGUAGE;
}
