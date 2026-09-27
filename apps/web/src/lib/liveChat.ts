import { CHAT_MESSAGE_MAX } from "@eventer/shared";
import type { ChatMember, ChatMembersPayload, EventLiveState } from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";

export interface LiveChatRow {
  source: "event";
  id: string;
  authoredAtMs: number;
  name: string;
  avatar: string | null;
  plainText: string;
}

/** Never load a URL from relay profile metadata or a foreign origin. */
export function safeChatAvatar(member: ChatMember): string | null {
  const url = member.avatarUrl;
  return url && /^\/api\/users\/[^/?#]+\/avatar\?v=\d+$/.test(url) && url.split("/")[3] === encodeURIComponent(member.userId) ? url : null;
}

export function liveChatAuthorized(
  state: Pick<EventLiveState, "chatSource"> | undefined,
  updatedAt: number,
  error: boolean,
  now: number,
  chat: ChatMembersPayload | undefined,
  eligible: boolean,
): boolean {
  return state?.chatSource === "event" && !error && updatedAt > 0 && now - updatedAt <= 5000 &&
    eligible && Boolean(chat?.chatEnabled && chat.channelId);
}

/** Selection uses only the current server-authorized member map. Removed/hidden posts lose their whole row, including image. */
export function liveChatRows(messages: NostrEvent[], chat: ChatMembersPayload, now: number, rows: number): LiveChatRow[] {
  const members = new Map(chat.members.map(member => [member.pubkey, member]));
  const hidden = new Set(chat.hiddenNoteIds);
  return messages.filter(message => members.has(message.pubkey) && !hidden.has(message.id) && message.content.length <= CHAT_MESSAGE_MAX &&
    Number.isFinite(message.created_at) && message.created_at * 1000 <= now + 30_000 && message.created_at * 1000 >= now - 60_000)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .slice(-Math.min(5, Math.max(2, rows)))
    .map(message => {
      const member = members.get(message.pubkey)!;
      return { source: "event", id: message.id, authoredAtMs: message.created_at * 1000, name: member.name, avatar: safeChatAvatar(member), plainText: message.content };
    });
}
