import type { ParseKeys } from "i18next";

/**
 * 画面に出す文言を**訳す前の形**で持つ (#369)。
 *
 * state に訳した文字列を入れると、表示中に言語を切り替えてもその文だけ前の言語で残る。
 * state にはキーと差し込む値だけを持ち、描画するときに `t(m.key, m.params)` で訳す
 * （AwardsPage の人数・CheckinPage のログ種別と同じ考え方）。
 * サーバーのエラーは例外そのもの（`unknown`）を持ち、描画で `errorMessage()` などに通す。
 */
export interface MessageKey {
  key: ParseKeys;
  params?: Record<string, string | number>;
}

/** `{ key, params }` を作る。呼び出し側で型の付いたキーを書くための薄い糊 */
export const messageKey = (key: ParseKeys, params?: MessageKey["params"]): MessageKey =>
  params ? { key, params } : { key };

/** 画面で決めた文言（キー）か、サーバーから断られた例外のどちらか。同じ欄に両方が出る画面用 */
export type KeyOrError = MessageKey | { error: unknown };

export const isMessageKey = (m: KeyOrError): m is MessageKey => "key" in m;
