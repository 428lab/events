import { CHAT_MESSAGE_MAX } from "@eventer/shared";
import type { ChatMember, EventLiveState } from "@eventer/shared";

/** 行にする入力。content は**平文**（暗号化チャット #582 では呼び出し側が復号済み） */
export interface LiveChatMessage {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
}

/** 行の名前解決と非表示に使う、サーバーが許可した一覧（平文の chat-members /
 * 暗号化チャットの payload のどちらでもよい） */
export interface LiveChatPermissions {
  members: ChatMember[];
  hiddenNoteIds: string[];
}

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

/** 配信状態がこれより古ければコメントを出さない（OBS の配信画面。1秒ポーリング） */
export const LIVE_SCREEN_STATE_FRESH_MS = 5000;
/** コントロールタブの表示用（5秒ポーリングの2周ぶん） */
export const LIVE_CONTROL_STATE_FRESH_MS = 10_000;

export function liveChatAuthorized(
  state: Pick<EventLiveState, "chatSource"> | undefined,
  updatedAt: number,
  error: boolean,
  now: number,
  /** 購読先が決まっているか（平文: chatEnabled と channelId / 暗号化: roomId） */
  chat: { chatEnabled: boolean; channelId: string | null } | undefined,
  eligible: boolean,
  stateFreshMs: number = LIVE_SCREEN_STATE_FRESH_MS,
): boolean {
  return state?.chatSource === "event" && !error && updatedAt > 0 && now - updatedAt <= stateFreshMs &&
    eligible && Boolean(chat?.chatEnabled && chat.channelId);
}

/** Selection uses only the current server-authorized member map. Removed/hidden posts lose their whole row, including image. */
export function liveChatRows(messages: LiveChatMessage[], chat: LiveChatPermissions, now: number, rows: number): LiveChatRow[] {
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
