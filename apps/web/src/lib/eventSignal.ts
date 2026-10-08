import { useCallback, useMemo, useRef, useState } from "react";
import { verifyEvent } from "nostr-tools/pure";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type { ChatHiddenSignal, EventSignalConfig } from "@eventer/shared";

/**
 * Server-signed ephemeral signals (D-POLL-MIN Phase 5a). Contract:
 * packages/shared/src/eventSignal.ts. The config (author, topic, rev) comes only
 * from an authenticated HTTP payload; relay data never chooses whom to trust.
 */

const NOTE_ID = /^[0-9a-f]{64}$/;
/** One signal names one note today; the cap only bounds a malformed signal. */
const CHAT_HIDDEN_IDS_MAX = 50;

/** Checks author, kind, topic and signature, then returns the JSON content with an integer rev. */
export function parseEventSignal(
  ev: NostrEvent,
  config: EventSignalConfig,
): (Record<string, unknown> & { rev: number }) | null {
  if (ev.kind !== EVENT_SIGNAL_KIND || config.kind !== EVENT_SIGNAL_KIND) return null;
  if (ev.pubkey !== config.pubkey) return null;
  if (!ev.tags.some((tag) => tag[0] === "t" && tag[1] === config.topic)) return null;
  let content: unknown;
  try {
    content = JSON.parse(ev.content);
  } catch {
    return null;
  }
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const rev = (content as { rev?: unknown }).rev;
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev <= 0) return null;
  if (!verifyEvent(ev)) return null;
  return content as Record<string, unknown> & { rev: number };
}

function noteIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > CHAT_HIDDEN_IDS_MAX) return null;
  return value.every((id) => typeof id === "string" && NOTE_ID.test(id)) ? value : null;
}

/** "chat-hidden" topic: note ids hidden or shown again. */
export function parseChatHiddenSignal(
  ev: NostrEvent,
  config: EventSignalConfig,
): ChatHiddenSignal | null {
  const content = parseEventSignal(ev, config);
  if (!content) return null;
  const hidden = noteIds(content.hidden);
  const shown = noteIds(content.shown);
  if (!hidden || !shown) return null;
  return { rev: content.rev, hidden, shown };
}

/** Latest signalled state per note id. */
export type ChatHiddenOverlay = ReadonlyMap<string, { hidden: boolean; rev: number }>;

/** Records a signal, keeping the newest rev per note (signals may arrive out of order). */
export function addChatHiddenSignal(
  overlay: ChatHiddenOverlay,
  signal: ChatHiddenSignal,
): ChatHiddenOverlay {
  const next = new Map(overlay);
  const put = (id: string, hidden: boolean) => {
    const prev = next.get(id);
    if (!prev || prev.rev < signal.rev) next.set(id, { hidden, rev: signal.rev });
  };
  for (const id of signal.hidden) put(id, true);
  for (const id of signal.shown) put(id, false);
  return next;
}

/** The payload's hidden list plus the signals newer than the payload.
 * Signals with rev <= payloadRev are already reflected in the payload. */
export function mergeChatHidden(
  payloadHidden: readonly string[],
  payloadRev: number,
  overlay: ChatHiddenOverlay,
): string[] {
  const hidden = new Set(payloadHidden);
  for (const [id, entry] of overlay) {
    if (entry.rev <= payloadRev) continue;
    if (entry.hidden) hidden.add(id);
    else hidden.delete(id);
  }
  return [...hidden];
}

/**
 * Applies "chat-hidden" signals on top of a chat payload's hiddenNoteIds.
 * `onSignal` is stable and reads the latest config, so it can be handed to a relay
 * subscription created inside an effect. Without a config (service key unset) it
 * returns the payload list.
 */
export function useChatHiddenSignal(
  config: EventSignalConfig | null | undefined,
  payloadHidden: readonly string[] | undefined,
) {
  const [overlay, setOverlay] = useState<ChatHiddenOverlay>(() => new Map());
  const configRef = useRef(config);
  configRef.current = config;
  const onSignal = useCallback((ev: NostrEvent) => {
    const current = configRef.current;
    if (!current) return;
    const signal = parseChatHiddenSignal(ev, current);
    if (!signal || signal.rev <= current.rev) return;
    setOverlay((prev) => addChatHiddenSignal(prev, signal));
  }, []);
  const rev = config?.rev ?? 0;
  const hiddenNoteIds = useMemo(
    () => mergeChatHidden(payloadHidden ?? [], rev, overlay),
    [payloadHidden, rev, overlay],
  );
  return { hiddenNoteIds, onSignal };
}

/** Value that changes only when the subscription target changes (null → config, or another event). */
export function eventSignalKey(config: EventSignalConfig | null | undefined): string {
  return config ? `${config.kind}:${config.pubkey}:${config.topic}` : "";
}
