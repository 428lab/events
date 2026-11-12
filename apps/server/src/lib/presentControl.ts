import { schnorr } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { PRESENT_PAGE_KIND, type PresentControlConfig } from "@eventer/shared";
import { getChatRelays } from "../db/repositories/appSettings.js";
import { eventStateRepo } from "../db/repositories/eventState.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { env } from "../runtime.js";
import { servicePubkey } from "./nostrSign.js";

/**
 * 発表のページめくり（docs/contest-organizer-ux.md「発表のページめくり」）。
 * サーバーはページ番号を中継しない。世代ごとの署名鍵と宛先（topic）を配り、
 * 世代の切り替えは `event-state` の合図で知らせるだけ。
 */

/** 世代ごとの宛先 `HMAC(サービス鍵, "eventer/present-page/v1:" + eventId + ":" + version)` */
export function presentPageTopic(eventId: string, version: number): string {
  return bytesToHex(hmac(sha256, hexToBytes(env.nostrServiceKey),
    utf8ToBytes(`eventer/present-page/v1:${eventId}:${version}`)));
}

/**
 * `GET /:id/state` に付ける設定。閲覧できる人なら誰でも受け取るが、秘密鍵（`secret`）は
 * その世代でめくれる人にだけ付ける:
 * - 運営に戻っているとき（staff）: そのイベントを運営として操作できる人
 * - 渡しているとき（presenter）: 発表中のエントリーのいまのメンバー（個人なら本人、チームなら全員）
 * サービス鍵が無い環境では null（手元だけでめくる）
 */
export async function presentControlConfig(
  eventId: string,
  presentingEntryId: string | null,
  viewer: { userId: string; isManager: boolean } | null,
): Promise<PresentControlConfig | null> {
  if (!servicePubkey()) return null;
  const row = await eventStateRepo.presentControl(eventId);
  if (!row.secret) return null;
  let holds = false;
  if (viewer) {
    if (row.control === "staff") holds = viewer.isManager;
    else holds = presentingEntryId !== null && (await entriesRepo.isMember(presentingEntryId, viewer.userId));
  }
  return {
    kind: PRESENT_PAGE_KIND,
    relays: await getChatRelays(),
    topic: presentPageTopic(eventId, row.version),
    version: row.version,
    pubkey: bytesToHex(schnorr.getPublicKey(hexToBytes(row.secret))),
    control: row.control,
    deckSlug: row.deckSlug,
    ...(holds ? { secret: row.secret } : {}),
  };
}
