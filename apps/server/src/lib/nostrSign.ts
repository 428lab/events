import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { env } from "../runtime.js";
import { nostrEventId } from "../auth/nostr.js";
import type { NostrEvent } from "../auth/nostr.js";

/**
 * events lab 公式サービス鍵によるサーバー署名 (#199)。
 * NIP-28 チャンネル作成（kind:40）を参加者の鍵に紐付けないため、
 * 主催者の NIP-07 が使えないケースではこの鍵で署名する。
 * 秘密鍵はシークレット NOSTR_SERVICE_KEY（64桁hex、環境ごとに別鍵）。
 */

const HEX64 = /^[0-9a-f]{64}$/;

/** 公式サービス鍵が設定されているか（形式チェック込み） */
export function serviceKeyConfigured(): boolean {
  return HEX64.test(env.nostrServiceKey);
}

/** 公式サービス鍵の公開鍵（hex）。未設定・形式不正なら null */
export function servicePubkey(): string | null {
  if (!serviceKeyConfigured()) return null;
  return bytesToHex(schnorr.getPublicKey(hexToBytes(env.nostrServiceKey)));
}

/** NIP-01 イベントを公式サービス鍵で署名して返す。未設定なら例外 */
export function signWithServiceKey(template: {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}): NostrEvent {
  if (!serviceKeyConfigured()) {
    throw new Error("NOSTR_SERVICE_KEY is not set");
  }
  const sk = hexToBytes(env.nostrServiceKey);
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const unsigned = { ...template, pubkey };
  const id = nostrEventId(unsigned);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...unsigned, id, sig };
}
