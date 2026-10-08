import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type { EventSignalConfig, EventSignalTopic } from "@eventer/shared";
import { getChatRelays } from "../db/repositories/appSettings.js";
import { eventChatRepo } from "../db/repositories/eventChat.js";
import { env } from "../runtime.js";
import { servicePubkey, signWithServiceKey } from "./nostrSign.js";
import { nostrRelay } from "./nostrRelay.js";

/**
 * Server-signed ephemeral signals to open screens (D-POLL-MIN Phase 5a).
 * Contract: packages/shared/src/eventSignal.ts and docs/event-signal.md.
 *
 * Nothing is stored and nothing is retried. A screen that missed a signal
 * catches up on its next HTTP refetch, which carries the same state.
 */

/** Opaque `t` tag for one event and topic. Derived from the service key, so it
 * reveals neither the event id nor the topic, and needs no stored column. */
function topicTag(eventId: string, topic: EventSignalTopic): string {
  return bytesToHex(hmac(sha256, hexToBytes(env.nostrServiceKey),
    utf8ToBytes(`eventer/signal/v1:${topic}:${eventId}`)));
}

export const eventSignal = {
  /** Subscription settings for an authenticated payload. `rev` is the server time
   * (ms) taken before the payload's state was read. Null without a service key. */
  config(eventId: string, topic: EventSignalTopic, rev: number): EventSignalConfig | null {
    const pubkey = servicePubkey();
    if (!pubkey) return null;
    return { kind: EVENT_SIGNAL_KIND, pubkey, topic: topicTag(eventId, topic), rev };
  },

  /** Sign and send one signal. `rev` is the server time (ms) taken before the state in
   * `fields` was read. Never throws: the change it announces is already committed. */
  async publish(eventId: string, topic: EventSignalTopic, rev: number, fields: Record<string, unknown>): Promise<void> {
    try {
      const pubkey = servicePubkey();
      if (!pubkey) return;
      const signal = signWithServiceKey({
        kind: EVENT_SIGNAL_KIND,
        created_at: Math.floor(rev / 1000),
        tags: [["t", topicTag(eventId, topic)], ["-"]],
        content: JSON.stringify({ ...fields, rev }),
      });
      const report = await nostrRelay.publishToRelays(await getChatRelays(), signal, signWithServiceKey);
      if (!report.ok) console.warn(`Event signal (${topic}) was not accepted by any relay`);
    } catch {
      console.warn(`Event signal (${topic}) failed`);
    }
  },

  /** "chat-hidden": the note's current hidden state, read after the change committed.
   * Reading it here (not trusting the caller) keeps admin restore correct when a
   * staff hide still applies. */
  async publishChatHidden(eventId: string, noteId: string): Promise<void> {
    try {
      if (!servicePubkey()) return;
      const rev = Date.now();
      const hidden = await eventChatRepo.isHidden(eventId, noteId);
      await this.publish(eventId, "chat-hidden", rev, hidden ? { hidden: [noteId], shown: [] } : { hidden: [], shown: [noteId] });
    } catch {
      console.warn("Event signal (chat-hidden) failed");
    }
  },
};
