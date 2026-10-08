import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Event as NostrEvent } from "nostr-tools/pure";
import type { EventSignalSource } from "@eventer/shared";
import { ChatRelayPool, randomLocalSigner } from "./nostrChat.js";
import { parseEventSignal } from "./eventSignal.js";

/**
 * One shared relay connection per tab for "refetch" signals (D-POLL-MIN Phase 5b,
 * docs/event-signal.md). Screens that have no chat connection of their own register
 * topics here instead of polling. Chat screens keep the "chat-hidden" subscription on
 * their own chat connection (Phase 5a).
 *
 * - The connection opens lazily with the first topic and closes HUB_IDLE_CLOSE_MS after
 *   the last one leaves, so route changes do not reconnect.
 * - All topics share one REQ per relay. A change in the topic set swaps the REQ after
 *   RESUBSCRIBE_DEBOUNCE_MS; the old REQ stays until the new one reaches EOSE.
 * - A signal is applied only if it is newer than the payload that handed out the topic
 *   (`rev`) and than the last signal handled. This drops the recent signals strfry
 *   returns before EOSE on a new REQ, and keeps the newer ones a screen missed while
 *   reconnecting.
 * - Nothing here polls. A missed signal is caught up by the next signal, focus or reload.
 */

/** How long the connection stays open after the last topic is released */
export const HUB_IDLE_CLOSE_MS = 30_000;
/** Batches topic registrations into one REQ swap */
export const RESUBSCRIBE_DEBOUNCE_MS = 250;
/** Jitter for topics that up to every participant watches (thousands of tabs) */
export const PARTICIPANT_SIGNAL_JITTER_MS = 5_000;

interface Listener {
  source: () => EventSignalSource;
  onSignal: () => unknown;
  jitterMs: number;
  lastRev: number;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  again: boolean;
}

interface HubSub {
  topics: ReadonlySet<string>;
  handle: { close: () => void; synced: () => boolean };
}

class SignalHub {
  private pool: ChatRelayPool | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private current: HubSub | null = null;
  private previous: HubSub | null = null;
  private resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private kind = 0;
  private pubkey = "";

  constructor(private relays: readonly string[]) {}

  add(topic: string, listener: Listener): () => void {
    const source = listener.source();
    this.kind = source.kind;
    this.pubkey = source.pubkey;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
      this.scheduleResubscribe();
    }
    set.add(listener);
    if (!this.pool) {
      this.pool = new ChatRelayPool(randomLocalSigner(), this.relays);
      this.pool.onstatus = () => this.onStatus();
      void this.pool.connect();
    }
    return () => this.remove(topic, listener);
  }

  /** The topic's REQ has reached EOSE on a relay that is connected now */
  isLive(topic: string): boolean {
    const live = (sub: HubSub | null) => Boolean(sub?.topics.has(topic) && sub.handle.synced());
    return live(this.current) || live(this.previous);
  }

  private remove(topic: string, listener: Listener): void {
    if (listener.timer) clearTimeout(listener.timer);
    listener.timer = null;
    listener.again = false;
    const set = this.listeners.get(topic);
    if (!set?.delete(listener)) return;
    if (set.size > 0) return;
    this.listeners.delete(topic);
    if (this.listeners.size > 0) {
      this.scheduleResubscribe();
      return;
    }
    this.idleTimer = setTimeout(() => this.close(), HUB_IDLE_CLOSE_MS);
  }

  private scheduleResubscribe(): void {
    if (this.resubscribeTimer) return;
    this.resubscribeTimer = setTimeout(() => {
      this.resubscribeTimer = null;
      this.resubscribe();
    }, RESUBSCRIBE_DEBOUNCE_MS);
  }

  private resubscribe(): void {
    if (!this.pool) return;
    const topics = new Set(this.listeners.keys());
    if (this.current && sameSet(this.current.topics, topics)) return;
    this.previous?.handle.close();
    this.previous = this.current;
    this.current = topics.size > 0
      ? {
          topics,
          handle: this.pool.subscribeSignal(
            [...topics].map((topic) => ({ kind: this.kind, pubkey: this.pubkey, topic })),
            (ev) => this.onEvent(ev),
          ),
        }
      : null;
    this.onStatus();
  }

  private onStatus(): void {
    // The old REQ covered the gap while the new one loaded; drop it once the new one is live
    if (this.previous && this.current?.handle.synced()) {
      this.previous.handle.close();
      this.previous = null;
    }
    notifyStatus();
  }

  private onEvent(ev: NostrEvent): void {
    if (!ev.tags.some((tag) => tag[0] === "-")) return;
    for (const tag of ev.tags) {
      if (tag[0] !== "t") continue;
      for (const listener of this.listeners.get(tag[1]) ?? []) {
        const source = listener.source();
        const content = parseEventSignal(ev, source);
        if (!content || content.rev <= Math.max(source.rev, listener.lastRev)) continue;
        listener.lastRev = content.rev;
        this.dispatch(listener);
      }
    }
  }

  /** One refetch per listener at a time: a signal during the jitter wait is absorbed,
   * and one during the refetch causes exactly one more */
  private dispatch(listener: Listener): void {
    if (listener.running) {
      listener.again = true;
      return;
    }
    if (listener.timer) return;
    listener.timer = setTimeout(() => {
      listener.timer = null;
      listener.running = true;
      void Promise.resolve()
        .then(() => listener.onSignal())
        .catch(() => undefined)
        .finally(() => {
          listener.running = false;
          if (listener.again) {
            listener.again = false;
            this.dispatch(listener);
          }
        });
    }, listener.jitterMs > 0 ? Math.random() * listener.jitterMs : 0);
  }

  close(): void {
    if (this.resubscribeTimer) clearTimeout(this.resubscribeTimer);
    this.resubscribeTimer = null;
    this.idleTimer = null;
    this.previous?.handle.close();
    this.current?.handle.close();
    this.previous = this.current = null;
    this.pool?.close();
    this.pool = null;
    if (hubs.get(relayKey(this.relays)) === this) hubs.delete(relayKey(this.relays));
    notifyStatus();
  }
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v));
}

const relayKey = (relays: readonly string[]) => [...relays].sort().join(" ");

/** Hubs per relay list (one in practice: the operator's chat relay setting) */
const hubs = new Map<string, SignalHub>();

/** Re-render hooks when any hub's connection or subscription state changes */
const statusListeners = new Set<() => void>();
function notifyStatus(): void {
  for (const callback of statusListeners) callback();
}
function onHubStatus(callback: () => void): () => void {
  statusListeners.add(callback);
  return () => statusListeners.delete(callback);
}

function hubFor(relays: readonly string[]): SignalHub {
  const key = relayKey(relays);
  let hub = hubs.get(key);
  if (!hub) {
    hub = new SignalHub(relays);
    hubs.set(key, hub);
  }
  return hub;
}

/** Test hook: drop every hub without waiting for idle timers */
export function resetSignalHubsForTest(): void {
  for (const hub of [...hubs.values()]) hub.close();
  hubs.clear();
}

export interface EventSignalOptions {
  /** Upper bound of a random delay before `onSignal`. 0 for operator screens; a few
   * seconds for topics that thousands of participants watch, so refetches spread out */
  jitterMs?: number;
  /** Stop listening when this event's access is reset (client.ts "event-access-reset") */
  eventId?: string;
}

/**
 * Calls `onSignal` (usually a react-query invalidate) once per "refetch" signal on the
 * source's topic. `source` comes from an authenticated HTTP payload; without it (no
 * service key, or not loaded yet) nothing is subscribed. Returns whether the topic's
 * subscription is live on the current connection.
 */
export function useEventSignal(
  source: EventSignalSource | null | undefined,
  onSignal: () => unknown,
  options: EventSignalOptions = {},
): { synced: boolean } {
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;
  const jitterMs = options.jitterMs ?? 0;
  const { eventId } = options;
  const topic = source?.topic ?? "";
  const relays = source ? relayKey(source.relays) : "";
  const subscribeKey = source ? `${source.kind}:${source.pubkey}:${topic}:${relays}` : "";

  useEffect(() => {
    const initial = sourceRef.current;
    if (!subscribeKey || !initial) return;
    const hub = hubFor(initial.relays);
    let remove: (() => void) | null = hub.add(initial.topic, {
      source: () => sourceRef.current ?? initial,
      onSignal: () => onSignalRef.current(),
      jitterMs,
      lastRev: 0,
      timer: null,
      running: false,
      again: false,
    });
    const stop = () => {
      remove?.();
      remove = null;
    };
    const onAccessReset = (event: Event) => {
      const id = (event as CustomEvent<string | undefined>).detail;
      if (!id || id === eventId) stop();
    };
    window.addEventListener("event-access-reset", onAccessReset);
    return () => {
      window.removeEventListener("event-access-reset", onAccessReset);
      stop();
    };
  }, [subscribeKey, jitterMs, eventId]);

  const getSynced = useCallback(
    () => Boolean(subscribeKey && hubs.get(relays)?.isLive(topic)),
    [subscribeKey, relays, topic],
  );
  const synced = useSyncExternalStore(onHubStatus, getSynced);
  return { synced };
}
