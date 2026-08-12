/**
 * 画面の言語まわりの入口 (#352)。
 *
 * 決め方は **URLの指定 (`?lang=en`) > 利用者の設定 > ブラウザの言語 > 日本語**。
 * 利用者の設定は設定ページで選ぶ端末ごとの値 (#354)。**その保存先を知るのは
 * `languagePreference.ts` だけ**で、ここの判定は保存領域に触らない
 * （触ると保存が禁じられた環境で起動時に例外が飛び、画面が真っ白になる）。
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
import { storedLanguage } from "./languagePreference.js";

/**
 * 表示言語を決める。副作用なし（テストから素で呼べる）。
 *
 * @param search `window.location.search` 相当
 * @param browserLanguages `navigator.languages` 相当
 * @param userPreference 利用者が選んだ言語。無指定なら URL とブラウザだけで決める
 */
export function detectLanguage(
  search: string,
  browserLanguages: readonly string[],
  userPreference?: string | null,
): AppLanguage {
  const urlLang = new URLSearchParams(search).get("lang");
  return resolveLanguage([urlLang, userPreference, ...browserLanguages]);
}

/**
 * 実際のブラウザの状態から言語を決める。起動時と、設定を切り替えたときに呼ぶ。
 *
 * **保存領域は読まない**。利用者の設定は呼ぶ側が読んで渡す
 * （`languagePreference.ts` の `storedLanguage()`）。
 */
export function detectFromEnvironment(
  userPreference?: string | null,
): AppLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const browser =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  return detectLanguage(window.location.search, browser, userPreference);
}

void i18next.use(initReactI18next).init({
  resources: {
    ja: { translation: translations.ja },
    en: { translation: translations.en },
  },
  lng: detectFromEnvironment(storedLanguage()),
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

/**
 * キーの一部が実行時にしか決まらない場合の逃げ道 (#352)。
 *
 * サーバーのエラーコードやロールのように、**サーバーが増やせる値**を
 * キーに混ぜるときは型で縛れない。逃げ道はここ1か所だけにしてあるので、
 * 各所で `as any` を書かないこと。`defaultValue` を必ず取るのは、
 * 辞書に無い値でもキー名が画面に出ないようにするため。
 *
 * 固定のキーには使わないこと（`t("nav.venues")` は型で守られる）。
 */
export function tDynamic(key: string, defaultValue: string): string {
  // `defaultValue` を渡す形なら i18next が任意のキーを受ける。
  // キャストを書かずに済むので、型の穴はここにも空けない
  return i18next.t(key, { defaultValue });
}

export { i18next };
