import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EventLiveState, LiveElement } from "@eventer/shared";
import { GROUP_CHAT_KIND } from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { useChatMembers } from "../api/eventChatHooks.js";
import { useEncryptedChat } from "../api/encryptedChatHooks.js";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";
import { ChatRelayPool, randomLocalSigner } from "../lib/nostrChat.js";
import { eventSignalKey, useChatHiddenSignal } from "../lib/eventSignal.js";
import { openGroupChatMessage, visibleAfterRevocation } from "../lib/groupChatCrypto.js";
import { LIVE_CONTROL_STATE_FRESH_MS, LIVE_SCREEN_STATE_FRESH_MS, liveChatAuthorized, liveChatRows } from "../lib/liveChat.js";
import type { LiveChatMessage, LiveChatPermissions, LiveChatRow } from "../lib/liveChat.js";

/** Rendered rows come only from the OBS live screen; the editor shows an empty frame, never simulated posts.
 * Participants-only (encrypted) chat (#582 design 4.4): the staff member's own session
 * receives the room keys and the screen decrypts; authorization is the same.
 *
 * Chat metadata is never polled (D-POLL-MIN Phase 5a). It loads on open and focus; the screen reads
 * it once more each time the hide/unhide signal subscription becomes active on a relay connection.
 *
 * page "screen" (OBS /live/screen): rows need, besides the 1 s live-state kill switch
 * (`chatSource`, which the server also turns "off" when the event's chat settings no longer
 * allow chat):
 * - the server-signed hide/unhide signal subscription (lib/eventSignal.ts) has reached EOSE on a
 *   connected relay, so hides reach the broadcast at once, and
 * - the metadata was fetched after that, because ephemeral signals sent while the screen was
 *   disconnected are not replayed by the relay.
 * Without a service key (no signal) the screen shows no rows.
 * page "control" (/live/control): only the operator's status text. Metadata must be loaded
 * without error, and the 5 s visible live-state poll gets a 10 s window. */
export function useLiveEventChat(eventId: string, state: EventLiveState | undefined, stateUpdatedAt: number, stateError: boolean, now: number, enabled: boolean, page: "screen" | "control") {
  const screen = page === "screen";
  const access = useEventChatAccess(eventId);
  const encrypted = Boolean(access.event?.chatEncrypted);
  const base = enabled && access.chatAvailable && !access.isError;
  const members = useChatMembers(eventId, base && !encrypted, true);
  const sealed = useEncryptedChat(eventId, base && encrypted, true);
  const source = encrypted ? sealed : members;
  const signalConfig = encrypted ? sealed.data?.hiddenSignal : members.data?.hiddenSignal;
  const hidden = useChatHiddenSignal(signalConfig, encrypted ? sealed.data?.hiddenNoteIds : members.data?.hiddenNoteIds);
  // A failed metadata fetch is not authorization, even if React Query retains its last payload.
  const eligible = base && !source.isError && source.dataUpdatedAt > 0 && (!screen || Boolean(signalConfig));
  const target = encrypted
    ? (sealed.data ? { chatEnabled: true, channelId: sealed.data.roomId } : undefined)
    : members.data;
  const authorized = liveChatAuthorized(state, stateUpdatedAt, stateError, now, target, eligible, screen ? LIVE_SCREEN_STATE_FRESH_MS : LIVE_CONTROL_STATE_FRESH_MS);
  const payload: (LiveChatPermissions & { relays: string[] }) | undefined = authorized
    ? (encrypted ? sealed.data ?? undefined : members.data)
    : undefined;
  // Hidden note ids: the payload's list plus the signals received since it was read.
  const chat = useMemo(() => payload && { ...payload, hiddenNoteIds: hidden.hiddenNoteIds }, [payload, hidden.hiddenNoteIds]);
  const keys = encrypted && authorized ? sealed.data?.keys : undefined;
  const [buffer, setBuffer] = useState<{ identity: string; messages: NostrEvent[]; connected: boolean; syncedAt: number }>({ identity: "", messages: [], connected: false, syncedAt: 0 });
  // Hidden ids are applied when rows are built, so a hide does not reconnect.
  const permissionKey = chat
    ? `${chat.members.map(m => `${m.pubkey}/${"revokedAt" in m ? m.revokedAt : ""}`).join(",")}:${(keys ?? []).map(k => k.version).join(",")}`
    : "";
  const relays = chat?.relays.join(" ") ?? "";
  const channel = target?.channelId;
  const kind = encrypted ? GROUP_CHAT_KIND : undefined;
  const signalKey = eventSignalKey(signalConfig);
  const signalRef = useRef({ config: signalConfig, onSignal: hidden.onSignal, refetch: source.refetch });
  signalRef.current = { config: signalConfig, onSignal: hidden.onSignal, refetch: source.refetch };
  // Effect cleanup runs after render: never interpret a previous event's buffer using new cached member metadata.
  const identity = chat && channel ? JSON.stringify([eventId, channel, relays, permissionKey, kind ?? 42, signalKey]) : "";
  useEffect(() => {
    // Changing event, source, permission, channel, keys or signal target disposes the relay and its buffer.
    setBuffer({ identity, messages: [], connected: false, syncedAt: 0 });
    if (!chat || !channel) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const pool = new ChatRelayPool(randomLocalSigner(), relays.split(" "));
    const config = signalRef.current.config;
    const signal = config ? pool.subscribeSignal([config], ev => { if (!disposed) signalRef.current.onSignal(ev); }) : null;
    let synced = false;
    pool.onstatus = () => {
      if (disposed) return;
      const nowSynced = signal?.synced() ?? false;
      // Signals sent while no relay delivered them are lost: read the hidden list again once the
      // subscription is live, and hold rows until that read has landed (syncedAt).
      const syncedAt = nowSynced && !synced ? Date.now() : undefined;
      if (syncedAt && screen) void signalRef.current.refetch?.();
      synced = nowSynced;
      setBuffer(prev => prev.identity === identity
        ? { ...prev, connected: pool.connected, syncedAt: !nowSynced ? 0 : syncedAt ?? prev.syncedAt }
        : prev);
    };
    void pool.connect().then(() => {
      if (disposed) return;
      unsubscribe = pool.subscribe(channel, ev => {
        if (disposed) return;
        setBuffer(prev => prev.identity !== identity || prev.messages.some(m => m.id === ev.id) ? prev : { ...prev, messages: [...prev.messages.slice(-99), ev] });
      }, kind);
    }).catch(() => { if (!disposed) setBuffer(prev => prev.identity === identity ? { ...prev, messages: [] } : prev); });
    return () => { disposed = true; unsubscribe?.(); signal?.close(); pool.close(); };
  }, [identity]);
  const current = buffer.identity === identity && Boolean(identity);
  const rows = useMemo(() => {
    if (!chat || !current) return [];
    let messages: LiveChatMessage[] = buffer.messages;
    if (encrypted) {
      // Decrypt with the current key ring; drop what cannot be opened and posts after revocation.
      const revokedAt = new Map(chat.members.map(m => [m.pubkey, "revokedAt" in m ? (m.revokedAt as number | null) : null]));
      messages = buffer.messages.flatMap(ev => {
        const revoked = revokedAt.get(ev.pubkey);
        if (revoked !== undefined && !visibleAfterRevocation(revoked, ev.created_at)) return [];
        const text = keys ? openGroupChatMessage(keys, ev) : null;
        return text === null ? [] : [{ id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, content: text }];
      });
    }
    return liveChatRows(messages, chat, now, 5);
  }, [buffer.messages, chat, now, current, encrypted, keys]);
  const signalLive = !screen || (buffer.syncedAt > 0 && source.dataUpdatedAt >= buffer.syncedAt);
  const connected = current && buffer.connected && signalLive;
  return { rows: authorized && connected ? rows : [], status: !enabled || state?.chatSource !== "event" ? "off" : !authorized ? "unavailable" : connected ? "on" : "connecting" } as const;
}

export function LiveEventChat({ el, rows, light }: { el: LiveElement; rows: LiveChatRow[]; light: boolean }) {
  const { t } = useTranslation();
  const visible = rows.filter(row => Date.now() - row.authoredAtMs <= (el.chatSeconds ?? 20) * 1000).slice(-(el.chatRows ?? 3));
  if (!visible.length) return null;
  const accent = el.chatStyle === "glow" ? "#FB923C" : el.chatStyle === "hakuji" ? "#285E91" : "#2DD4BF";
  return <div style={{ height: "100%", width: "100%", boxSizing: "border-box", padding: 10, overflow: "hidden", borderLeft: `4px solid ${accent}`, borderRadius: 10, background: light ? "rgba(246,242,234,.96)" : "rgba(14,20,38,.88)", color: light ? "#203146" : "#EAF0F7", fontFamily: '"Noto Sans JP", sans-serif', lineHeight: 1.25, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 7 }}>
    {visible.map(row => <div key={row.id} style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0, flex: 1, maxHeight: `${100 / visible.length}%` }}>
      <span style={{ width: 34, height: 34, flex: "0 0 34px", position: "relative", borderRadius: "50%", background: accent, color: el.chatStyle === "hakuji" ? "#FFFFFF" : "#0E1426", display: "grid", placeItems: "center", overflow: "hidden", fontSize: 17 }}>
        {[...row.name][0] ?? "?"}{row.avatar ? <img src={row.avatar} alt="" onError={e => { e.currentTarget.style.display = "none"; }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", width: "100%" }}>
        <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}><strong title={row.name} style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "65%", fontSize: 17 }}>{row.name}</strong><small style={{ color: accent, whiteSpace: "nowrap", fontSize: 12 }}>{t("studio.chatSourceEvent")}</small></span>
        <span style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere", fontSize: 19 }}>{row.plainText}</span>
      </span>
    </div>)}
  </div>;
}
