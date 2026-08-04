import { bytesToHex } from "@noble/hashes/utils.js";
import { env } from "../runtime.js";
import { one, run } from "../db/client.js";

/**
 * アカウント統合コード (#240)。
 * Nostr チャレンジ（nostr.ts の issueNostrChallenge/verifyChallenge）と同じ
 * HMAC 署名のステートレストークン方式。purpose をドメイン分離して混用を防ぎ、
 * 使い捨ては同じ nostr_challenge_used テーブル（nonce の一意挿入）で実現する。
 * 形式: `userId:ts:nonce:mac`（userId は UUID なので ":" を含まない）
 */

/** 有効期限。注意: nostr.ts 側の使い捨て記録クリーンアップ（CHALLENGE_TTL_MS * 2 =
 * 20分）より短く保つこと。これを20分以上に延ばすと、共有テーブルの nonce 記録が
 * 有効期限内に掃除されてコードのリプレイが可能になる */
const MERGE_CODE_TTL_MS = 15 * 60 * 1000;
const PURPOSE = "account-merge";

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(sig));
}

/** 統合コードを発行する（15分有効・1回限り）。サーバー状態は持たない */
export async function issueMergeCode(userId: string): Promise<string> {
  const ts = Date.now();
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const mac = await hmacHex(`${PURPOSE}:${userId}:${ts}:${nonce}`);
  return `${userId}:${ts}:${nonce}:${mac}`;
}

/** 署名と有効期限を検証し、発行者の userId を返す（未使用チェックはしない）。
 * 消費前に「自分自身への統合」等を弾けるよう、consume とは分離している */
export async function parseMergeCode(code: string): Promise<string | null> {
  const parts = code.split(":");
  if (parts.length !== 4) return null;
  const [userId, tsStr, nonce, mac] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return null;
  // 発行から15分まで有効（未来の ts は多少の時計ずれのみ許容）
  const age = Date.now() - ts;
  if (age > MERGE_CODE_TTL_MS || age < -60_000) return null;
  // MAC入力には受信した tsStr をそのまま使う（正準形を1つに固定）。
  // 比較は双方を再HMACしてから行い、タイミング差を消す
  const expected = await hmacHex(`${PURPOSE}:${userId}:${tsStr}:${nonce}`);
  if ((await hmacHex(expected)) !== (await hmacHex(mac))) {
    return null;
  }
  return userId;
}

/** コードを使用済みにする。既に使われていれば false（リプレイ防止） */
export async function consumeMergeCode(code: string): Promise<boolean> {
  const userId = await parseMergeCode(code);
  if (!userId) return false;
  const nonce = code.split(":")[2];
  const inserted = await one<{ nonce: string }>(
    `INSERT OR IGNORE INTO nostr_challenge_used (nonce, used_at)
     VALUES (?, ?) RETURNING nonce`,
    nonce,
    Date.now(),
  );
  if (!inserted) return false;
  // TTL を過ぎた記録は掃除（テーブル肥大防止）
  await run(
    "DELETE FROM nostr_challenge_used WHERE used_at < ?",
    Date.now() - MERGE_CODE_TTL_MS * 2,
  );
  return true;
}
