import { env } from "../runtime.js";
import { consumeNonce, isNonceUsed } from "./usedNonce.js";

/**
 * 出会い確定QRのトークン (#330)。
 * `mt1.<userId>.<exp>.<nonce>.<sig>` 形式の署名付き・使い切りトークン。
 *
 * 以前のQRは公開プロフィールのURLだったので、URLを知っているだけで誰でも開けた。
 * 対面していない相手が出会い（と受付代わりの出席）を成立させられないよう、
 * **1つのトークンは1回しか使えない**ようにする。画面の写真を後から渡されても、
 * 目の前の人が読んだ時点で使用済みになっているので成立しない。
 *
 * 使い切りにしたぶん有効期限は緩めてよい。その場で新規登録する人が
 * OAuth の往復を終える前に切れると、正常なQRを読み直させることになるため。
 *
 * 署名は lib/checkinToken.ts と同じ流儀（SESSION_SECRET の HMAC-SHA256、
 * 用途プレフィックスでドメイン分離）。
 */

/**
 * トークンの有効期間（秒）。
 *
 * 使い切りが効くので短くする必要がない。10分にしたのは:
 * - その場で新規登録する人の OAuth 往復（サインアップ込み）に間に合わせる
 * - 使用済み記録を捨てる基準が要る（後述の共有テーブルの掃除に合わせる）
 * - 誰にも読まれなかったQRが生き続けるのを防ぐ
 * なお出会いの記録には開催時間帯（前30分〜後2時間）の条件が別途あるので、
 * イベントが終われば有効期限内でも使えない。
 *
 * 変更したら lib/usedNonce.ts の SHARED_TTLS_MS も直すこと（使用済み記録の
 * 掃除しきい値がそこで全用途の最長 TTL から決まっている）。
 */
export const MEET_TOKEN_TTL_SEC = 10 * 60;

/**
 * 1枚のQRを出し続ける上限（秒）。
 *
 * 使い切りなので有効期限は10分あるが、読まれないかぎり同じQRが出続けると、
 * その画面を撮った写真が10分間使えることになる（不在の人に先に消費されると
 * 目の前の人が読めない）。読み取りが終わらないうちに切り替わらない長さは
 * 残しつつ、写真が効く窓を1分台に抑える。 */
export const MEET_TOKEN_MAX_DISPLAY_SEC = 90;

/** そのトークンを出し始めてから MEET_TOKEN_MAX_DISPLAY_SEC を過ぎたか。
 * 発行時刻はトークン自身の exp から逆算できるので、保存は増やさない */
export function meetTokenTooOld(exp: number, now = Date.now()): boolean {
  const issuedAtSec = exp - MEET_TOKEN_TTL_SEC;
  return now / 1000 - issuedAtSec > MEET_TOKEN_MAX_DISPLAY_SEC;
}

/** 使用済み記録の nonce につける接頭辞。共有テーブルで他用途の nonce と
 * ぶつからないようにする（衝突すると片方が「使用済み」に見えてしまう） */
const USED_NONCE_PREFIX = "meet:";

/**
 * 取り消しトークンの有効期間（秒）。
 * 「読み取った直後に気づいて戻す」ための猶予で、10分あれば足りる。
 * 長く持たせるほど、後から出席や出会いを剥がせる時間が伸びるだけなので短くする。
 * これを過ぎたぶんの訂正は、運営画面の出席チェックで行う。 */
export const MEET_UNDO_TTL_SEC = 10 * 60;

/** 署名の長さ（hex 文字数）。HMAC-SHA256 の先頭16バイト=128ビットに切り詰める。
 * QRは対面で少し離れた位置から読むので、モジュール数を増やさないことが
 * 読み取り成功率に効く。128ビットあれば総当たりでの推測は成立しない */
const SIG_HEX_LEN = 32;

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
    .join("")
    .slice(0, SIG_HEX_LEN);
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

export async function createMeetToken(
  userId: string,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(now / 1000) + MEET_TOKEN_TTL_SEC;
  // nonce は使用済み記録の鍵。推測不能である必要はない（署名が別にある）が、
  // 同時に出回るトークン同士でぶつからない程度の幅は要る
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const sig = await hmacHex(`meet:${userId}:${exp}:${nonce}`);
  return { token: `mt1.${userId}.${exp}.${nonce}.${sig}`, expiresAt: exp * 1000 };
}

export type MeetTokenVerifyResult =
  | { ok: true; userId: string; exp: number; nonce: string }
  | { ok: false; reason: "invalid" | "expired" };

/** 署名と有効期限だけを検証する（使用済みかは見ない）。
 * 「自分自身のQR」等を消費前に弾けるよう、consume とは分けている */
export async function verifyMeetToken(
  token: string,
  now = Date.now(),
): Promise<MeetTokenVerifyResult> {
  // userId は UUID（"." を含まない）なので "." split で安全に分解できる
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "mt1") {
    return { ok: false, reason: "invalid" };
  }
  const [, userId, expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!userId || !Number.isInteger(exp) || !nonce || !sig) {
    return { ok: false, reason: "invalid" };
  }
  const expected = await hmacHex(`meet:${userId}:${exp}:${nonce}`);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "invalid" };
  if (exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, userId, exp, nonce };
}

/** トークンを使用済みにする。既に使われていれば false（＝2回目以降）。
 * 記録先と掃除は lib/usedNonce.ts に集約している */
export async function consumeMeetToken(nonce: string): Promise<boolean> {
  return consumeNonce(USED_NONCE_PREFIX + nonce);
}

/** そのトークンが既に読み取られたか。表示側が「読まれたら描き替える」ために使う。
 * 記録は消さないので、何度呼んでも結果は変わらない */
export async function isMeetTokenUsed(nonce: string): Promise<boolean> {
  return isNonceUsed(USED_NONCE_PREFIX + nonce);
}
/**
 * 取り消しトークン (#330)。
 *
 * 「その読み取りが実際に書いた行」だけを取り消せるようにするための封筒。
 * 取り消し対象をクライアントの自己申告（相手のID・イベントID）で受けると、
 * 確定メンバーなら誰でも「相手が記録した出会い」や「受付で正規に付いた出席」を
 * 剥がせてしまう。そこで scan 側が書いた内容そのものを署名して持たせ、
 * undo はこのトークン以外を受け付けない。
 *
 * ペイロードは JSON を base64url にしただけで秘匿性はない（読めても、
 * 署名できないので改竄はできない）。
 */
export interface MeetUndoPayload {
  /** 読み取った側（このトークンを使えるのはこの人だけ） */
  scannerId: string;
  /** QRの持ち主 */
  targetId: string;
  /** この読み取りが実際に書いたぶん。書いていないイベントは入らない */
  grants: {
    eventId: string;
    /** この読み取りで出会いを作った */
    meetCreated: boolean;
    /** この読み取りで読み取った側を出席にした */
    attendedMe: boolean;
    /** この読み取りで持ち主を出席にした */
    attendedTarget: boolean;
  }[];
  /** 有効期限（epoch 秒） */
  exp: number;
}

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string | null {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function createUndoToken(
  payload: Omit<MeetUndoPayload, "exp">,
  now = Date.now(),
): Promise<string> {
  const body: MeetUndoPayload = {
    ...payload,
    exp: Math.floor(now / 1000) + MEET_UNDO_TTL_SEC,
  };
  const encoded = base64UrlEncode(JSON.stringify(body));
  // 用途プレフィックスでQRのトークンとドメイン分離する（同じ鍵の使い回しを防ぐ）
  const sig = await hmacHex(`meet-undo:${encoded}`);
  return `mu1.${encoded}.${sig}`;
}

export type MeetUndoVerifyResult =
  | { ok: true; payload: MeetUndoPayload }
  | { ok: false; reason: "invalid" | "expired" };

export async function verifyUndoToken(
  token: string,
  now = Date.now(),
): Promise<MeetUndoVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "mu1") {
    return { ok: false, reason: "invalid" };
  }
  const [, encoded, sig] = parts;
  const expected = await hmacHex(`meet-undo:${encoded}`);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "invalid" };
  const json = base64UrlDecode(encoded);
  if (!json) return { ok: false, reason: "invalid" };
  let payload: MeetUndoPayload;
  try {
    payload = JSON.parse(json) as MeetUndoPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    typeof payload?.scannerId !== "string" ||
    typeof payload?.targetId !== "string" ||
    !Array.isArray(payload?.grants) ||
    !Number.isInteger(payload?.exp)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (payload.exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
