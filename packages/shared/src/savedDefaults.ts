import { savedDefaults } from "./i18n/messages/savedDefaults.js";
import { normalizeLanguage, DEFAULT_LANGUAGE, type AppLanguage } from "./i18n/languages.js";

/**
 * 保存される既定の文言を、作る人の言語で組み立てる (#364)。
 *
 * 決まり（オーナー決定 2026-08-13 を保存データ全体に当てはめた。2026-11-19）:
 * **既定・テンプレートが利用者のデータとして保存されるときは、作る人の言語で書く。**
 * 保存したあとは普通のデータなので、見る人の言語に訳し直さない。
 * 文言は `i18n/messages/savedDefaults.ts`。日本語は以前の直書きと同じ綴り。
 *
 * 言語を省くと日本語（以前の挙動のまま）。
 */
export type SavedDefaultKey = keyof (typeof savedDefaults)["ja"];

export function savedText(
  lang: AppLanguage | string | null | undefined,
  key: SavedDefaultKey,
  params: Record<string, string | number> = {},
): string {
  const table = savedDefaults[normalizeLanguage(lang ?? undefined) ?? DEFAULT_LANGUAGE];
  return table[key].replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
    params[name] === undefined ? "" : String(params[name]),
  );
}
