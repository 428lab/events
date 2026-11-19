import { DEFAULT_LANGUAGE, normalizeLanguage, type AppLanguage } from "@eventer/shared/i18n";
import { i18next } from "./index.js";

/**
 * 保存される既定の文言を書く言語 = 今の画面の言語 (#364)。
 *
 * 既定・テンプレートが利用者のデータとして保存されるときは、作る人の言語で書く
 * （オーナー決定。`packages/shared/src/savedDefaults.ts`）。
 */
export function creatorLanguage(): AppLanguage {
  return normalizeLanguage(i18next.resolvedLanguage) ?? DEFAULT_LANGUAGE;
}
