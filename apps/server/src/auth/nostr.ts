import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { env } from "../runtime.js";

/** NIP-01 イベント（NIP-07 拡張が署名して返す形） */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

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

/** サーバー状態を持たない署名付きチャレンジを発行（ts:nonce:mac） */
export async function issueNostrChallenge(): Promise<string> {
  const ts = Date.now();
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const mac = await hmacHex(`nostr-challenge:${ts}:${nonce}`);
  return `${ts}:${nonce}:${mac}`;
}

async function verifyChallenge(challenge: string): Promise<boolean> {
  const parts = challenge.split(":");
  if (parts.length !== 3) return false;
  const [tsStr, nonce, mac] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CHALLENGE_TTL_MS) {
    return false;
  }
  return (await hmacHex(`nostr-challenge:${ts}:${nonce}`)) === mac;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** NIP-01 イベントの構造・id・schnorr署名を検証（kind は問わない） */
export function verifyEventSignature(ev: NostrEvent): boolean {
  if (
    !ev ||
    typeof ev.id !== "string" ||
    typeof ev.pubkey !== "string" ||
    typeof ev.sig !== "string" ||
    typeof ev.kind !== "number" ||
    typeof ev.created_at !== "number" ||
    !Array.isArray(ev.tags) ||
    typeof ev.content !== "string"
  ) {
    return false;
  }
  if (!HEX64.test(ev.id) || !HEX64.test(ev.pubkey) || !HEX128.test(ev.sig)) {
    return false;
  }
  // NIP-01: id = sha256(serialize(event))
  const serialized = JSON.stringify([
    0,
    ev.pubkey,
    ev.created_at,
    ev.kind,
    ev.tags,
    ev.content,
  ]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  if (id !== ev.id) return false;
  try {
    return schnorr.verify(
      hexToBytes(ev.sig),
      hexToBytes(ev.id),
      hexToBytes(ev.pubkey),
    );
  } catch {
    return false;
  }
}

/**
 * NIP-07 で署名されたログインイベント（kind 22242, NIP-42 準拠）を検証し、
 * 正当なら pubkey(hex) を返す。不正なら null。
 */
export async function verifyNostrLogin(ev: NostrEvent): Promise<string | null> {
  if (!verifyEventSignature(ev)) return null;
  if (ev.kind !== 22242) return null;
  // 時刻ずれは10分まで
  if (Math.abs(Date.now() / 1000 - ev.created_at) > 600) return null;
  // challenge タグの検証（このサーバーが発行した新鮮なものか）
  const challenge = ev.tags.find((t) => t[0] === "challenge")?.[1];
  if (!challenge || !(await verifyChallenge(challenge))) return null;
  return ev.pubkey;
}

/** kind:0（プロフィール）イベントを検証し、名前とアイコンURLを取り出す */
export function extractNostrProfile(
  ev: NostrEvent,
): { pubkey: string; name: string | null; picture: string | null } | null {
  if (!verifyEventSignature(ev) || ev.kind !== 0) return null;
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(ev.content);
  } catch {
    return null;
  }
  const pick = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const name = pick(meta.display_name) ?? pick(meta.name);
  const rawPicture = pick(meta.picture);
  const picture =
    rawPicture && /^https?:\/\//.test(rawPicture) && rawPicture.length <= 500
      ? rawPicture
      : null;
  return { pubkey: ev.pubkey, name, picture };
}
