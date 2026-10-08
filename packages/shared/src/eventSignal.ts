/** Server-signed ephemeral Nostr signals for open screens (D-POLL-MIN Phase 5a).
 *
 * One kind for every topic. Relays forward ephemeral events (20000–29999) to live
 * subscriptions and do not keep them, so a signal only reaches screens that are open
 * and subscribed. A screen that missed one catches up on its next HTTP refetch.
 *
 * The event is signed with the environment's service key and carries
 * `["t", <topic>]` and NIP-70 `["-"]`. `<topic>` is an opaque per-event, per-topic
 * hex string that the server hands out in authenticated HTTP payloads only.
 * The content is JSON with an integer `rev` (server epoch ms) plus topic fields. */
export const EVENT_SIGNAL_KIND = 20078;

/** Topics that use the signal. Each topic defines its own content fields. */
export type EventSignalTopic = "chat-hidden";

/** What a client needs to subscribe to one topic of one event. */
export interface EventSignalConfig {
  kind: typeof EVENT_SIGNAL_KIND;
  /** Service pubkey; signals by any other author are ignored */
  pubkey: string;
  /** Opaque `t` tag value for this event and topic */
  topic: string;
  /** Server epoch ms when the payload carrying this config was read.
   * Signals with rev <= this are already reflected in the payload. */
  rev: number;
}

/** Content of a "chat-hidden" signal: note ids hidden or shown again. */
export interface ChatHiddenSignal {
  rev: number;
  hidden: string[];
  shown: string[];
}
