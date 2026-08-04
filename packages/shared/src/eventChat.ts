import { z } from "zod";

/** Nostr イベントチャット (#199)。
 * NIP-28 パブリックチャットをブラウザから直接ユーザー所有リレーに読み書きする。
 * サーバーは「イベント⇔チャンネル⇔メンバー鍵」の紐付けと設定のみ保持し、
 * チャット本文は一切経由しない。 */

/** 読み書きに使うリレーの既定値（運用設定 chat_relays が未設定のとき使用） */
export const CHAT_RELAYS = ["wss://r.kojira.io", "wss://x.kojira.io"] as const;

/** リレーURLの上限数 */
export const CHAT_RELAY_MAX = 5;

/** リレーURLの形式（wss:// のみ許可） */
export const CHAT_RELAY_URL_PATTERN = /^wss:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/.*)?$/;

/** 書き込み可能な時間帯: 開始30分前〜終了2時間後。
 * 値は出会った記録 (#189) の MEET_WINDOW_BEFORE_MS / MEET_WINDOW_AFTER_MS
 * （apps/server/src/db/repositories/eventMeets.ts）と同じ窓 */
export const CHAT_WINDOW_BEFORE_MS = 30 * 60_000;
export const CHAT_WINDOW_AFTER_MS = 2 * 60 * 60_000;

/** 1メッセージの最大文字数 */
export const CHAT_MESSAGE_MAX = 500;

/** Nostr の公開鍵・イベントID（64桁小文字hex） */
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

/** 発言に使う公開鍵の登録（イベント×ユーザーごとに1つ。再登録で置き換え） */
/** NIP-01 イベント（所有証明・チャンネル登録用の生イベント） */
export const nostrEventInput = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  sig: z.string().regex(/^[0-9a-f]{128}$/),
  kind: z.number().int(),
  created_at: z.number().int(),
  tags: z.array(z.array(z.string()).max(10)).max(20),
  content: z.string().max(2000),
});
export type NostrEventInput = z.infer<typeof nostrEventInput>;

export const registerChatPubkeyInput = z.object({
  /** 所有証明: 専用kindでchallenge等に署名したNostrイベント */
  proof: nostrEventInput,
});
export type RegisterChatPubkeyInput = z.infer<typeof registerChatPubkeyInput>;

/** NIP-28 チャンネル（kind:40 イベントID）の登録。先勝ちで1回だけ設定される */
export const registerChatChannelInput = z.object({
  /** 署名済みの kind:40 チャンネル作成イベント（本人の登録済み鍵で署名） */
  channelEvent: nostrEventInput,
});
export type RegisterChatChannelInput = z.infer<typeof registerChatChannelInput>;

/** アプリ側で非表示にするメッセージ（kind:42 の note id）。staff のみ */
export const hideChatNoteInput = z.object({
  noteId: hex64,
});
export type HideChatNoteInput = z.infer<typeof hideChatNoteInput>;

/** 表示許可リストの1人分（この pubkey のメッセージだけを描画し、名前/アイコンを解決する） */
export const chatMemberSchema = z.object({
  pubkey: z.string(),
  userId: z.string(),
  username: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type ChatMember = z.infer<typeof chatMemberSchema>;

/** GET /events/:id/chat-members のレスポンス */
export interface ChatMembersPayload {
  members: ChatMember[];
  channelId: string | null;
  chatEnabled: boolean;
  hiddenNoteIds: string[];
  /** 読み書きに使うリレー（運用設定。未設定なら CHAT_RELAYS） */
  relays: string[];
}

/** PUT /admin/settings/chat-relays の入力。relays=[] で既定に戻す */
export const updateChatRelaysInput = z.object({
  relays: z
    .array(z.string().max(200).regex(CHAT_RELAY_URL_PATTERN))
    .max(CHAT_RELAY_MAX),
});
export type UpdateChatRelaysInput = z.infer<typeof updateChatRelaysInput>;

/** GET /admin/settings のレスポンス */
export interface AppSettingsPayload {
  /** 実効値（未設定なら既定の CHAT_RELAYS） */
  chatRelays: string[];
  /** 運用設定で上書きされているか */
  chatRelaysCustom: boolean;
}
