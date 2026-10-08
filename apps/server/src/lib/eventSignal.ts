import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type {
  EventSignalConfig,
  EventSignalRefetchTopic,
  EventSignalSource,
  EventSignalTopic,
} from "@eventer/shared";
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

/** Opaque `t` tag for one scope and topic. The scope is an event id (a user id for
 * `meet-token`). Derived from the service key, so it reveals neither the scope nor the
 * topic, and needs no stored column. It never includes `accessRevision`: that changes on
 * every join and would move the topic away from screens that are already open. */
function topicTag(scopeId: string, topic: EventSignalTopic): string {
  return bytesToHex(hmac(sha256, hexToBytes(env.nostrServiceKey),
    utf8ToBytes(`eventer/signal/v1:${topic}:${scopeId}`)));
}

/** One refetch topic of one scope: `[topic, eventId]` (`["meet-token", userId]`). */
export type RefetchSignalTarget = readonly [EventSignalRefetchTopic, string];

/** Sends one `{rev}` signal tagged with every target's topic. Never throws. */
async function publishRefetchNow(targets: readonly RefetchSignalTarget[]): Promise<void> {
  if (targets.length === 0) return;
  const tags = [...new Set(targets.map(([topic, scopeId]) => topicTag(scopeId, topic)))];
  const names = [...new Set(targets.map(([topic]) => topic))].join(",");
  try {
    if (!servicePubkey()) return;
    const rev = Date.now();
    const signal = signWithServiceKey({
      kind: EVENT_SIGNAL_KIND,
      created_at: Math.floor(rev / 1000),
      tags: [...tags.map((tag) => ["t", tag]), ["-"]],
      content: JSON.stringify({ rev }),
    });
    const report = await nostrRelay.publishToRelays(await getChatRelays(), signal, signWithServiceKey);
    if (!report.ok) console.warn(`Event signal (${names}) was not accepted by any relay`);
  } catch {
    console.warn(`Event signal (${names}) failed`);
  }
}

/** Gap between two signals for the same topic from one isolate (burst writes:
 * votes, scans, card issue, score submission). */
export const SIGNAL_THROTTLE_MS = 2_000;

/**
 * Per-isolate throttle for bursty writers. The first change in a window is sent at
 * once; later changes in the window collapse into one trailing signal at the end of
 * the window, awaited inside the same background task. Isolates do not share state,
 * so a burst spread over isolates sends more signals, never fewer. If the isolate is
 * evicted before the trailing signal, the next write announces the change.
 */
export function createSignalThrottle(
  send: (targets: readonly RefetchSignalTarget[]) => Promise<void>,
  windowMs = SIGNAL_THROTTLE_MS,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const lastSent = new Map<string, number>();
  const trailing = new Set<string>();
  const keyOf = ([topic, scopeId]: RefetchSignalTarget) => `${topic}:${scopeId}`;
  return async (targets: readonly RefetchSignalTarget[]): Promise<void> => {
    const leading: RefetchSignalTarget[] = [];
    const later: Array<Promise<void>> = [];
    const at = now();
    for (const target of targets) {
      const key = keyOf(target);
      const last = lastSent.get(key);
      if (last === undefined || at - last >= windowMs) {
        lastSent.set(key, at);
        leading.push(target);
      } else if (!trailing.has(key)) {
        trailing.add(key);
        later.push((async () => {
          await sleep(last + windowMs - at);
          trailing.delete(key);
          lastSent.set(key, now());
          await send([target]);
        })());
      }
    }
    await Promise.all([send(leading), ...later]);
  };
}

const publishRefetchThrottled = createSignalThrottle(publishRefetchNow);

export const eventSignal = {
  /** Subscription settings for an authenticated payload. `rev` is the server time
   * (ms) taken before the payload's state was read. Null without a service key. */
  config(scopeId: string, topic: EventSignalTopic, rev: number): EventSignalConfig | null {
    const pubkey = servicePubkey();
    if (!pubkey) return null;
    return { kind: EVENT_SIGNAL_KIND, pubkey, topic: topicTag(scopeId, topic), rev };
  },

  /** `config` plus the relays the signal is published to, for screens that have no chat
   * connection of their own (D-POLL-MIN Phase 5b). Null without a service key. */
  async source(scopeId: string, topic: EventSignalRefetchTopic, rev: number): Promise<EventSignalSource | null> {
    const config = this.config(scopeId, topic, rev);
    return config ? { ...config, relays: await getChatRelays() } : null;
  },

  /** "This data changed, refetch it once" for each target, as one Nostr event with one
   * `t` tag per target. Call after the change committed, inside `deferBackground`.
   * Never throws; nothing is stored or retried (D-POLL-MIN Phase 5b). */
  publishRefetch(targets: readonly RefetchSignalTarget[]): Promise<void> {
    return publishRefetchNow(targets);
  },

  /** `publishRefetch` through the per-isolate throttle, for writers that can burst. */
  publishRefetchThrottled(targets: readonly RefetchSignalTarget[]): Promise<void> {
    return publishRefetchThrottled(targets);
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
