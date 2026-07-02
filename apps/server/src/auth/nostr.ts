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

/**
 * NIP-07 で署名されたログインイベント（kind 22242, NIP-42 準拠）を検証し、
 * 正当なら pubkey(hex) を返す。不正なら null。
 */
export async function verifyNostrLogin(ev: NostrEvent): Promise<string | null> {
  if (
    !ev ||
    typeof ev.id !== "string" ||
    typeof ev.pubkey !== "string" ||
    typeof ev.sig !== "string" ||
    !Array.isArray(ev.tags) ||
    typeof ev.content !== "string"
  ) {
    return null;
  }
  if (ev.kind !== 22242) return null;
  if (!HEX64.test(ev.id) || !HEX64.test(ev.pubkey) || !HEX128.test(ev.sig)) {
    return null;
  }
  // 時刻ずれは10分まで
  if (Math.abs(Date.now() / 1000 - ev.created_at) > 600) return null;

  // challenge タグの検証（このサーバーが発行した新鮮なものか）
  const challenge = ev.tags.find((t) => t[0] === "challenge")?.[1];
  if (!challenge || !(await verifyChallenge(challenge))) return null;

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
  if (id !== ev.id) return null;

  // schnorr 署名検証
  try {
    if (
      !schnorr.verify(hexToBytes(ev.sig), hexToBytes(ev.id), hexToBytes(ev.pubkey))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return ev.pubkey;
}
