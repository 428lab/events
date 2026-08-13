import { i18next, tDynamic } from "../i18n/index.js";

/**
 * Bluesky のログイン・連携が失敗したときのクエリ (#381)。
 *
 * **`link_error` とは別のクエリ**。`link_error` の表は知らないコードを
 * 「別ユーザーに連携済み」の文言に落とすので、混ぜると誤った説明が出る（設計 12）。
 */
export const BLUESKY_ERROR_PARAM = "bluesky_error";

/** サーバーが返したコードを文言にする。知らないコードは既定の文言に落ちる */
export function blueskyErrorMessage(code: string | null | undefined): string {
  const fallback = i18next.t("blueskyError.default");
  return code ? tDynamic(`blueskyError.${code}`, fallback) : fallback;
}

/** 表示したクエリを URL から消す。リロードや「戻る」で再表示させないため */
export function clearQueryParam(name: string): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState(null, "", url.toString());
}
