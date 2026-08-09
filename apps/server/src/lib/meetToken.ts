import { env } from "../runtime.js";

/**
 * 出会い確定QRのトークン (#330)。
 * `mt1.<userId>.<exp>.<sig>` 形式の署名付き短寿命トークン。
 *
 * 以前のQRは公開プロフィールのURLだったので、URLを知っているだけで誰でも開けた。
 * 対面していない相手が出会い（と受付代わりの出席）を成立させられないよう、
 * 「いまその画面を見ている」ことを有効期限で担保する。
 *
 * 署名は lib/checkinToken.ts と同じ流儀（SESSION_SECRET の HMAC-SHA256、
 * 用途プレフィックスでドメイン分離）。サーバー側の保存は増やさない。
 *
 * 使い捨てとはいえ単回限りにはしない。自分のQRを次々に読んでもらう使い方
 * （1枚のQRを複数人が読む）が本来の用途なので、短い有効期限と表示側の
 * 描き替えで担保する。
 */

/**
 * トークンの有効期間（秒）。表示側は MEET_TOKEN_REFRESH_SEC ごとに取り直すので、
 * 読み取る側から見た残り有効時間は常に 120-30=90 秒以上になる。
 *
 * 120秒にした理由:
 * - 短すぎると、未ログインの人がログインを終える前に切れて読み直しになる
 * - 長すぎると、QRを撮った写真を後から渡すだけで成立してしまう
 * 対面で読み取ってから記録が走るまで（ログイン込み）に必要な時間の見積もりが
 * この程度で、写真の転送・拡散に耐える長さではない、という釣り合いで決めた。
 */
export const MEET_TOKEN_TTL_SEC = 120;

/** 表示側がQRを描き替える間隔（秒）。TTL より十分短く保つこと */
export const MEET_TOKEN_REFRESH_SEC = 30;

/** 署名の長さ（hex 文字数）。HMAC-SHA256 の先頭16バイト=128ビットに切り詰める。
 * QRは対面で少し離れた位置から読むので、モジュール数を増やさないことが
 * 読み取り成功率に効く。128ビットあれば総当たりでの推測は成立しない */
const SIG_HEX_LEN = 32;

/**
 * 取り消しトークンの有効期間（秒）。
 * 「読み取った直後に気づいて戻す」ための猶予で、10分あれば足りる。
 * 長く持たせるほど、後から出席や出会いを剥がせる時間が伸びるだけなので短くする。
 * これを過ぎたぶんの訂正は、運営画面の出席チェックで行う。 */
export const MEET_UNDO_TTL_SEC = 10 * 60;

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
  const sig = await hmacHex(`meet:${userId}:${exp}`);
  return { token: `mt1.${userId}.${exp}.${sig}`, expiresAt: exp * 1000 };
}

export type MeetTokenVerifyResult =
  | { ok: true; userId: string; exp: number }
  | { ok: false; reason: "invalid" | "expired" };

export async function verifyMeetToken(
  token: string,
  now = Date.now(),
): Promise<MeetTokenVerifyResult> {
  // userId は UUID（"." を含まない）なので "." split で安全に分解できる
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "mt1") {
    return { ok: false, reason: "invalid" };
  }
  const [, userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!userId || !Number.isInteger(exp) || !sig) {
    return { ok: false, reason: "invalid" };
  }
  const expected = await hmacHex(`meet:${userId}:${exp}`);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: "invalid" };
  if (exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, userId, exp };
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
