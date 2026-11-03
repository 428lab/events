import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { DECK_SYNC_KIND } from "@eventer/shared";
import type { DeckSyncConfig } from "@eventer/shared";
import { appSettingsRepo, getChatRelays } from "../db/repositories/appSettings.js";
import { many } from "../db/client.js";
import { env } from "../runtime.js";
import { eventSignal } from "./eventSignal.js";
import { servicePubkey } from "./nostrSign.js";

/**
 * チームのスライドの同時編集のサーバー側 (docs/team-deck-live-sync.md §4)。
 * サーバーは差分を中継しない。鍵と宛先（topic）を配り、世代の切り替えを合図で知らせるだけ。
 */

/** 機能フラグ（app_setting）。値が "1" のときだけオン。既定はオフ */
export const DECK_LIVE_SYNC_KEY = "deck_live_sync";

export async function deckLiveSyncEnabled(): Promise<boolean> {
  return (await appSettingsRepo.get(DECK_LIVE_SYNC_KEY)) === "1";
}

/** 世代ごとの宛先 `HMAC(サービス鍵, "eventer/deck-sync/v1:" + deckId + ":" + version)`（§4.3） */
export function deckSyncTopic(deckId: string, version: number): string {
  return bytesToHex(hmac(sha256, hexToBytes(env.nostrServiceKey),
    utf8ToBytes(`eventer/deck-sync/v1:${deckId}:${version}`)));
}

/** 編集用の GET に付ける設定。鍵はリポジトリが編集判定と同じ SQL で読んだもの（N1）。
 * 機能オフ・サービス鍵なしなら null（今の動作） */
export async function deckSyncConfig(
  deckId: string,
  key: { version: number; secret: string },
  me: { userId: string; name: string },
  rev: number,
): Promise<DeckSyncConfig | null> {
  if (!servicePubkey()) return null;
  return {
    kind: DECK_SYNC_KIND,
    relays: await getChatRelays(),
    topic: deckSyncTopic(deckId, key.version),
    key,
    me,
    signal: await eventSignal.source(deckId, "deck-sync", rev),
  };
}

/** メンバーが変わりうる操作が確定したあと、そのイベントの全チームのスライドへ `deck-sync` の
 * 合図を1件で送る（§4.4）。機能オフ・チームのスライドが無ければ何もしない。失敗しても投げない */
export async function publishDeckSync(eventId: string): Promise<void> {
  try {
    if (!(await deckLiveSyncEnabled())) return;
    const decks = await many<{ id: string }>(
      `SELECT d.id FROM deck d JOIN entry en ON en.id = d.team_entry_id
        WHERE en.event_id = ? AND en.kind = 'team'`,
      eventId,
    );
    if (decks.length === 0) return;
    await eventSignal.publishRefetch(decks.map((d) => ["deck-sync", d.id] as const));
  } catch {
    console.warn("Deck sync signal failed");
  }
}

/** 退会の申請のように、イベントをまたいで「その人がいるチームのスライド全部」へ知らせる */
export async function publishDeckSyncForUser(userId: string): Promise<void> {
  try {
    if (!(await deckLiveSyncEnabled())) return;
    const decks = await many<{ id: string }>(
      `SELECT d.id FROM deck d JOIN entry_member em ON em.entry_id = d.team_entry_id WHERE em.user_id = ?`,
      userId,
    );
    if (decks.length === 0) return;
    await eventSignal.publishRefetch(decks.map((d) => ["deck-sync", d.id] as const));
  } catch {
    console.warn("Deck sync signal failed");
  }
}
