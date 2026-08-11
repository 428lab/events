/**
 * 画面の言語まわりの入口 (#352)。
 *
 * 決め方は **URLの指定 (`?lang=en`) > 利用者の設定 > ブラウザの言語 > 日本語**。
 * 利用者ごとの設定はまだ無いので、いまは URL とブラウザだけを見る
 * （設定が入ったら `detectLanguage` の候補に足すだけで済むようにしてある）。
 *
 * 辞書は `@eventer/shared/i18n` にある。ここが持つのは
 * 「どう選ぶか」と「i18next にどう渡すか」だけ。
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DATE_LOCALES,
  DEFAULT_LANGUAGE,
  resolveLanguage,
  translations,
  type AppLanguage,
} from "@eventer/shared/i18n";

/**
 * 表示言語を決める。副作用なし（テストから素で呼べる）。
 *
 * @param search `window.location.search` 相当
 * @param browserLanguages `navigator.languages` 相当
 * @param userPreference 利用者が選んだ言語。まだ設定が無いので既定は undefined
 */
export function detectLanguage(
  search: string,
  browserLanguages: readonly string[],
  userPreference?: string | null,
): AppLanguage {
  const urlLang = new URLSearchParams(search).get("lang");
  return resolveLanguage([urlLang, userPreference, ...browserLanguages]);
}

function detectFromEnvironment(): AppLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const browser =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  return detectLanguage(window.location.search, browser);
}

void i18next.use(initReactI18next).init({
  resources: {
    ja: { translation: translations.ja },
    en: { translation: translations.en },
  },
  lng: detectFromEnvironment(),
  // 訳がまだ無いキーは日本語のまま出す。第2段階までは英語表示に日本語が
  // 混ざるが、空欄やキー名が出るより読める
  fallbackLng: DEFAULT_LANGUAGE,
  // React が既に描画時にエスケープするので、二重にしない
  interpolation: { escapeValue: false },
});

/** `document.documentElement.lang` を実際の言語に合わせる（読み上げ・辞書機能のため） */
export function syncDocumentLanguage(): void {
  if (typeof document === "undefined") return;
  const apply = () => {
    document.documentElement.lang = i18next.resolvedLanguage ?? DEFAULT_LANGUAGE;
  };
  apply();
  i18next.on("languageChanged", apply);
}

/**
 * 日時の書式に使うロケール。
 *
 * **タイムゾーンは端末のまま**。Intl に timeZone を渡さないので、
 * テストのタイムゾーン固定 (#322, apps/web/vitest.config.ts) もそのまま効く。
 */
export function dateLocale(): string {
  const lang = (i18next.resolvedLanguage ?? DEFAULT_LANGUAGE) as AppLanguage;
  return DATE_LOCALES[lang] ?? DATE_LOCALES[DEFAULT_LANGUAGE];
}

export { i18next };
