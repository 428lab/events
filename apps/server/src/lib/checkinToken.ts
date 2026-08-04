import { env } from "../runtime.js";

/**
 * QR受付の入場チケット (#154)。
 * `evt1.<eventId>.<userId>.<exp>.<sig>` 形式の署名付き短寿命トークン。
 * プロフィールURLのQRは公開情報でスクリーンショット等で使い回せるため、
 * 「アカウントを実際に開いている」ことの証明としてこちらを本人確認の主経路にする。
 * 署名は email.ts の unsubscribeToken と同じ流儀（SESSION_SECRET の HMAC-SHA256、
 * 用途プレフィックス `checkin:` でドメイン分離）。
 */

/** チケットの有効期間（秒）。QR表示側は60秒ごとに再取得して常に新鮮に保つ */
export const CHECKIN_TOKEN_TTL_SEC = 180;

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
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** タイミング攻撃を避ける定数時間比較（hex 文字列想定） */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createCheckinToken(
  eventId: string,
  userId: string,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(now / 1000) + CHECKIN_TOKEN_TTL_SEC;
  const sig = await hmacHex(`checkin:${eventId}:${userId}:${exp}`);
  return {
    token: `evt1.${eventId}.${userId}.${exp}.${sig}`,
    expiresAt: exp * 1000,
  };
}

export type CheckinTokenVerifyResult =
  | { ok: true; eventId: string; userId: string; exp: number }
  | { ok: false; reason: "invalid" | "expired" };

export async function verifyCheckinToken(
  token: string,
  now = Date.now(),
): Promise<CheckinTokenVerifyResult> {
  // eventId/userId は UUID（"." を含まない）なので "." split で安全に分解できる
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "evt1") {
    return { ok: false, reason: "invalid" };
  }
  const [, eventId, userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!eventId || !userId || !Number.isInteger(exp) || !sig) {
    return { ok: false, reason: "invalid" };
  }
  const expected = await hmacHex(`checkin:${eventId}:${userId}:${exp}`);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "invalid" };
  if (exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, eventId, userId, exp };
}
