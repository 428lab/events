import { v2 } from "nostr-tools/nip44";
import type { EventTemplate } from "nostr-tools/pure";
import {
  GROUP_CHAT_KIND,
  GROUP_CHAT_VERSION_TAG,
  type StaffChatKey,
} from "@eventer/shared";
import { buildChannelMessageTemplate } from "./nostrChat.js";

/**
 * スタッフチャット (#382) の暗号化まわりの薄い純粋関数。
 *
 * 暗号プリミティブは**自作しない**。使うのは nostr-tools の監査済み NIP-44 v2
 * 実装だけで、ここが持つのは「どの世代の鍵で封をする/開けるか」（v タグ）だけ。
 * 鍵はサーバーが配るグループ共通鍵（乱数32バイト）で、NIP-44 v2 の
 * conversation key（32バイトの一様な鍵）としてそのまま使える（設計 2.3）。
 */

/** NIP-44 に渡す前の暗号文サイズの粗いふるい。本文の上限は CHAT_MESSAGE_MAX
 * （500字）で、NIP-44 v2 のパディング・base64・ヘッダを含めてもこの長さには
 * 届かない。外部クライアントからの巨大投稿に復号を試みない（UIを固めない）ため */
export const CIPHERTEXT_MAX = 4096;

function keyBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 新規発言は常に**最新 version** で暗号化する（設計 7.2。配列の並び順に頼らない） */
export function latestKey(keys: StaffChatKey[]): StaffChatKey | null {
  let latest: StaffChatKey | null = null;
  for (const k of keys) {
    if (!latest || k.version > latest.version) latest = k;
  }
  return latest;
}

/** 本文を最新の鍵で暗号化し、部屋（e タグ）と鍵世代（v タグ）を付けた
 * 署名前テンプレートを返す。鍵が1つも無ければ null（送信できない） */
export function sealStaffChatMessage(
  roomId: string,
  keys: StaffChatKey[],
  text: string,
  relayHint: string,
): EventTemplate | null {
  const key = latestKey(keys);
  if (!key) return null;
  const template = buildChannelMessageTemplate(
    roomId,
    v2.encrypt(text, keyBytes(key.secret)),
    relayHint,
    GROUP_CHAT_KIND,
  );
  template.tags.push([GROUP_CHAT_VERSION_TAG, String(key.version)]);
  return template;
}

/** 受信イベントを復号する。開けないもの（v タグ無し・手元に無い version・
 * 壊れた/別の鍵の暗号文）は null ＝ そのメッセージだけ描画しない（設計 9.2）。
 * 復号失敗は攻撃とは限らない（ローテーション直後の取り残し等）ので throw しない */
export function openStaffChatMessage(
  keys: StaffChatKey[],
  message: { content: string; tags: string[][] },
): string | null {
  if (message.content.length > CIPHERTEXT_MAX) return null;
  const versionTag = message.tags.find(
    (t) => t[0] === GROUP_CHAT_VERSION_TAG && t[1],
  );
  if (!versionTag) return null;
  const version = Number(versionTag[1]);
  const key = keys.find((k) => k.version === version);
  if (!key) return null;
  try {
    return v2.decrypt(message.content, keyBytes(key.secret));
  } catch {
    return null;
  }
}

/** 資格を失った人（revokedAt 付き）のメッセージを描画してよいか（設計 7.3）。
 * 失効より後に作られたものは出さない：抜けた人が旧鍵で書き込んでも
 * アプリの画面には出ない（participant チャットの締め出し #283 と同じ効き方）。
 * revokedAt はサーバーの ms、created_at は Nostr の秒。 */
export function visibleAfterRevocation(
  revokedAt: number | null,
  createdAtSec: number,
): boolean {
  return revokedAt === null || createdAtSec * 1000 <= revokedAt;
}
