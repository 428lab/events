import { schnorr } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { PRESENT_PAGE_KIND, deckSlugFromUrl, type LiveContestDeck, type PresentControlConfig } from "@eventer/shared";
import { getChatRelays } from "../db/repositories/appSettings.js";
import { eventStateRepo } from "../db/repositories/eventState.js";
import { entriesRepo } from "../db/repositories/entries.js";
import { decksRepo } from "../db/repositories/decks.js";
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

/**
 * 配信をコンテストの発表に連動させる（docs/contest-organizer-ux.md「配信との連動」）。
 * 発表中のエントリーのスライド: 運営が選んだもの（present_deck_slug）、なければ資料URLの /d/:slug。
 * events lab のスライドだけ（外部URLは扱わない）。`present` は秘密鍵を付けない（配信画面は見るだけ）
 */
export async function liveContestDeck(eventId: string, origin: string): Promise<LiveContestDeck> {
  const state = await eventStateRepo.getOrInit(eventId);
  const entry = state.presentingEntryId ? await entriesRepo.findActive(eventId, state.presentingEntryId) : null;
  // 見るだけの視点で読む（viewer=null なので secret は付かない）。サービス鍵が無ければ null
  const config = await presentControlConfig(eventId, entry?.id ?? null, null);
  const chosen = (await eventStateRepo.presentControl(eventId)).deckSlug;
  // 資料URLは、このサーバーの公開URL（APP_BASE_URL。チームのスライドを作ると入る形）か、
  // リクエストの origin の /d/:slug
  const url = entry?.submission?.presentationUrl;
  const slug = chosen ?? deckSlugFromUrl(url, env.appBaseUrl) ?? deckSlugFromUrl(url, origin);
  const deck = entry && slug ? await decksRepo.findBySlug(slug) : null;
  return {
    entryId: entry?.id ?? null,
    entryName: entry?.name ?? null,
    deckId: deck?.id ?? null,
    slug: deck ? slug : null,
    present: config,
  };
}
