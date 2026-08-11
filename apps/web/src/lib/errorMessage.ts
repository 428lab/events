/**
 * サーバーのエラーコードを人が読める文にする (#352)。
 *
 * サーバーは `{ error: "コード" }` しか返さない。対応表は
 * `@eventer/shared/i18n` の `errors` **1か所**にあるので、画面ごとに
 * 分岐を書かないこと。その画面でしか意味をなさない言い方をしたいときだけ
 * `overrides` にコードを渡す（渡さなかったコードは辞書のまま出る）。
 * `overrides.default` を渡すと、辞書に無いコードのときの文言も差し替わる。
 */
import { ApiError, NetworkError } from "../api/client.js";
import { i18next, tDynamic } from "../i18n/index.js";

/** 例外からサーバーのエラーコードを取り出す。取れなければ null */
export function errorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = (err.body as { error?: unknown } | null)?.error;
  return typeof code === "string" ? code : null;
}

export function errorMessage(
  err: unknown,
  overrides?: Readonly<Record<string, string>>,
): string {
  if (err instanceof NetworkError) {
    return i18next.t(err.timedOut ? "errors.timeout" : "errors.network");
  }
  const fallback = overrides?.default ?? i18next.t("errors.default");
  const code = errorCode(err);
  if (!code) return fallback;
  // `in` で見るのは、空文字での上書き（「この画面では何も出さない」）を
  // 潰さないため。truthy 判定だと空文字が無かったことにされる
  if (overrides && code in overrides) return overrides[code];
  return tDynamic(`errors.${code}`, fallback);
}
