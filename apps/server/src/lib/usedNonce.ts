import { one, run } from "../db/client.js";

/**
 * 使い捨てトークンの「使用済み」記録 (#240 → #330)。
 *
 * nostr ログインチャレンジ・アカウント統合コード・出会いQRの3つが
 * nostr_challenge_used テーブルを共有している。用途ごとにテーブルを増やしても
 * 掃除の仕組みが増えるだけなので、nonce に用途の接頭辞を付けて共有する。
 *
 * 掃除のしきい値をここに集約しているのは、**片方の用途の有効期限だけを見て
 * 短く設定すると、まだ有効な別用途の記録を消してリプレイの窓を開けてしまう**
 * ため。各用途の有効期限は下の TTL 一覧に必ず足すこと。
 */

/** この共有テーブルを使う全用途の有効期限（ミリ秒）。
 * 新しい用途を足すときは、その TTL をここにも足すこと */
const SHARED_TTLS_MS = {
  /** auth/nostr.ts の CHALLENGE_TTL_MS */
  nostrChallenge: 10 * 60 * 1000,
  /** auth/mergeCode.ts の MERGE_CODE_TTL_MS */
  mergeCode: 15 * 60 * 1000,
  /** lib/meetToken.ts の MEET_TOKEN_TTL_SEC */
  meetToken: 10 * 60 * 1000,
} as const;

/**
 * 記録を消す基準（ミリ秒）。全用途のうち最長の有効期限の2倍。
 *
 * 「最長」で取るのが要点で、いちばん短い用途に合わせると、有効期限内の
 * 別用途のトークンが使い回せるようになる。2倍にしているのは時計ずれと
 * 掃除の間隔ぶんの余裕。
 */
export const USED_NONCE_RETENTION_MS =
  Math.max(...Object.values(SHARED_TTLS_MS)) * 2;

/**
 * nonce を使用済みにする。既に使われていれば false（＝2回目以降）。
 *
 * nonce は PRIMARY KEY なので、INSERT OR IGNORE … RETURNING が返るのは
 * 挿入できた1回だけ。D1 は単一ライターなので、同時に2本走っても
 * どちらか一方しか true にならない。
 */
export async function consumeNonce(key: string): Promise<boolean> {
  const inserted = await one<{ nonce: string }>(
    `INSERT OR IGNORE INTO nostr_challenge_used (nonce, used_at)
     VALUES (?, ?) RETURNING nonce`,
    key,
    Date.now(),
  );
  if (!inserted) return false;
  await cleanupUsedNonces();
  return true;
}

/**
 * 使用済みの記録を取り消す（`consumeNonce` で確保した nonce を手放す）。
 *
 * 「先に原子的に確保してから処理し、何も起きなければ返す」形のためのもの。
 * 確保した本人だけが呼ぶこと。他人の nonce を解放すると使い回しが可能になる。
 */
export async function releaseNonce(key: string): Promise<void> {
  await run("DELETE FROM nostr_challenge_used WHERE nonce = ?", key);
}

/** 使用済みかを見るだけ（記録は増やさない）。何度呼んでも結果は変わらない */
export async function isNonceUsed(key: string): Promise<boolean> {
  const row = await one<{ nonce: string }>(
    "SELECT nonce FROM nostr_challenge_used WHERE nonce = ?",
    key,
  );
  return Boolean(row);
}

/** 有効期限を過ぎた記録を消す（テーブル肥大防止）。
 * 期限切れは検証側でも弾けるので、残しても意味がない */
export async function cleanupUsedNonces(): Promise<void> {
  await run(
    "DELETE FROM nostr_challenge_used WHERE used_at < ?",
    Date.now() - USED_NONCE_RETENTION_MS,
  );
}
