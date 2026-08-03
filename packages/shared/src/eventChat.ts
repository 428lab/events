import { z } from "zod";

/** Nostr イベントチャット (#199)。
 * NIP-28 パブリックチャットをブラウザから直接ユーザー所有リレーに読み書きする。
 * サーバーは「イベント⇔チャンネル⇔メンバー鍵」の紐付けと設定のみ保持し、
 * チャット本文は一切経由しない。 */

/** 読み書きに使うリレー（両方に書き、両方から読む） */
export const CHAT_RELAYS = ["wss://r.kojira.io", "wss://x.kojira.io"] as const;

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
export const registerChatPubkeyInput = z.object({
  pubkey: hex64,
});
export type RegisterChatPubkeyInput = z.infer<typeof registerChatPubkeyInput>;

/** NIP-28 チャンネル（kind:40 イベントID）の登録。先勝ちで1回だけ設定される */
export const registerChatChannelInput = z.object({
  channelId: hex64,
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
}
