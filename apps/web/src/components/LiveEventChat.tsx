import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EventLiveState, LiveElement } from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { useChatMembers } from "../api/eventChatHooks.js";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";
import { ChatRelayPool, randomLocalSigner } from "../lib/nostrChat.js";
import { liveChatAuthorized, liveChatRows } from "../lib/liveChat.js";
import type { LiveChatRow } from "../lib/liveChat.js";

/** Mounted only by the live screen; editor shows an empty frame, never simulated posts. */
export function useLiveEventChat(eventId: string, state: EventLiveState | undefined, stateUpdatedAt: number, stateError: boolean, now: number, enabled: boolean) {
  const access = useEventChatAccess(eventId);
  const members = useChatMembers(eventId, enabled && access.chatAvailable && !access.isError, true);
  // A failed metadata fetch is not authorization, even if React Query retains its last payload.
  const eligible = enabled && access.chatAvailable && !access.isError && !members.isError &&
    members.dataUpdatedAt > 0 && now - members.dataUpdatedAt <= 6000;
  const authorized = liveChatAuthorized(state, stateUpdatedAt, stateError, now, members.data, eligible);
  const chat = authorized ? members.data : undefined;
  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const permissionKey = chat ? `${chat.members.map(m => m.pubkey).join(",")}:${chat.hiddenNoteIds.join(",")}` : "";
  const relays = chat?.relays.join(" ") ?? "";
  const channel = chat?.channelId;
  useEffect(() => {
    // Changing event, source, permission, channel, or freshness disposes the relay and its buffer.
    setMessages([]);
    setConnected(false);
    if (!chat || !channel) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const pool = new ChatRelayPool(randomLocalSigner(), relays.split(" "));
    pool.onstatus = () => { if (!disposed) setConnected(pool.connected); };
    void pool.connect().then(() => {
      if (disposed) return;
      unsubscribe = pool.subscribe(channel, ev => {
        if (disposed) return;
        setMessages(prev => prev.some(m => m.id === ev.id) ? prev : [...prev.slice(-99), ev]);
      });
    }).catch(() => { if (!disposed) setMessages([]); });
    return () => { disposed = true; unsubscribe?.(); pool.close(); setMessages([]); };
  }, [eventId, Boolean(chat), channel, relays, permissionKey]);
  const rows = useMemo(() => chat ? liveChatRows(messages, chat, now, 5) : [], [messages, chat, now]);
  return { rows: authorized && connected ? rows : [], status: !enabled || state?.chatSource !== "event" ? "off" : !authorized ? "unavailable" : connected ? "on" : "connecting" } as const;
}

export function LiveEventChat({ el, rows, light }: { el: LiveElement; rows: LiveChatRow[]; light: boolean }) {
  const { t } = useTranslation();
  const visible = rows.filter(row => Date.now() - row.authoredAtMs <= (el.chatSeconds ?? 20) * 1000).slice(-(el.chatRows ?? 3));
  if (!visible.length) return null;
  const accent = el.chatStyle === "glow" ? "#FB923C" : el.chatStyle === "hakuji" ? "#285E91" : "#2DD4BF";
  return <div style={{ height: "100%", width: "100%", boxSizing: "border-box", padding: 10, overflow: "hidden", borderLeft: `4px solid ${accent}`, borderRadius: 10, background: light ? "rgba(246,242,234,.96)" : "rgba(14,20,38,.88)", color: light ? "#203146" : "#EAF0F7", fontFamily: '"Noto Sans JP", sans-serif', lineHeight: 1.25, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 7 }}>
    {visible.map(row => <div key={row.id} style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0, flex: 1, maxHeight: `${100 / visible.length}%` }}>
      <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: "50%", background: accent, color: "#0E1426", display: "grid", placeItems: "center", overflow: "hidden", fontSize: 17 }}>
        {row.avatar ? <img src={row.avatar} alt="" onError={e => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}{[...row.name][0] ?? "?"}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", width: "100%" }}>
        <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}><strong title={row.name} style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "65%", fontSize: 17 }}>{row.name}</strong><small style={{ color: accent, whiteSpace: "nowrap", fontSize: 12 }}>{t("studio.chatSourceEvent")}</small></span>
        <span style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere", fontSize: 19 }}>{row.plainText}</span>
      </span>
    </div>)}
  </div>;
}
