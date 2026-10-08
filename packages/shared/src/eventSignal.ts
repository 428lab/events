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

/** Topics that carry their own content fields (the screen applies them directly). */
export type EventSignalDataTopic = "chat-hidden";

/** Topics whose signal is only `{rev}`: "this data changed, refetch it once"
 * (D-POLL-MIN Phase 5b). The scope is an event id, except `meet-token`, whose scope is
 * a user id. Staff-only topics are handed out only by staff-gated endpoints. */
export type EventSignalRefetchTopic =
  | "event-state"
  | "scores"
  | "live"
  | "qa"
  | "bingo"
  | "bingo-staff"
  | "meet-ranking"
  | "prize-desk"
  | "schedule-editing"
  | "broadcasts"
  | "meet-token";

/** Topics that use the signal. */
export type EventSignalTopic = EventSignalDataTopic | EventSignalRefetchTopic;

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

/** Where a screen without a chat connection listens for refetch signals: the topic
 * plus the relays the server publishes to (the operator's chat relay setting). */
export interface EventSignalSource extends EventSignalConfig {
  relays: string[];
}

/** Content of a "chat-hidden" signal: note ids hidden or shown again. */
export interface ChatHiddenSignal {
  rev: number;
  hidden: string[];
  shown: string[];
}
