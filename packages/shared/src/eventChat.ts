import { z } from "zod";
import type { EventSignalConfig } from "./eventSignal.js";

/** Nostr イベントチャット (#199)。
 * NIP-28 パブリックチャットをブラウザから直接ユーザー所有リレーに読み書きする。
 * サーバーは「イベント⇔チャンネル⇔メンバー鍵」の紐付けと設定のみ保持し、
 * チャット本文は一切経由しない。 */

/** 読み書きに使うリレーの既定値（運用設定 chat_relays が未設定のとき使用） */
export const CHAT_RELAYS = ["wss://r.kojira.io", "wss://x.kojira.io"] as const;

/** リレーURLの上限数 */
export const CHAT_RELAY_MAX = 5;

/** リレーURLの形式（wss:// のみ許可） */
export const CHAT_RELAY_URL_PATTERN = /^wss:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/\S*)?$/;

/** 書き込める期間 (#578)。主催者がイベントごとに選ぶ。
 * - 始まり: 開始の何分前から（`chatOpenBeforeMinutes`）。null は下限なし
 *   ＝参加が確定したらすぐ（参加確定はチャットを開ける条件として別に見ている）
 * - 終わり: 終了の何分後まで（`chatCloseAfterMinutes`）
 *
 * 既定は従来の「開始30分前〜終了2時間後」。値は出会った記録 (#189) の
 * MEET_WINDOW_BEFORE_MS / MEET_WINDOW_AFTER_MS（apps/server/src/db/repositories/eventMeets.ts）
 * と同じ窓で、マイグレーション 0106 の列の既定値とも一致させてある */
export const CHAT_OPEN_BEFORE_DEFAULT_MINUTES = 30;
export const CHAT_CLOSE_AFTER_DEFAULT_MINUTES = 120;

/** 「開始の N 日前から」で選べる N の範囲 */
export const CHAT_OPEN_BEFORE_DAYS_MIN = 1;
export const CHAT_OPEN_BEFORE_DAYS_MAX = 30;

const MINUTES_PER_DAY = 24 * 60;

/** 終わりの選択肢: 終了2時間後 / 1日後 / 7日後（分）。先頭が既定値 */
export const CHAT_CLOSE_AFTER_OPTIONS = [120, 1440, 10080] as const;

/** 始まりの値: 30（開始30分前・既定） / N日前（1440 の倍数・1〜30日） / null（参加確定したらすぐ） */
export const chatOpenBeforeMinutesSchema = z
  .number()
  .int()
  .refine(
    (m) =>
      m === CHAT_OPEN_BEFORE_DEFAULT_MINUTES ||
      (m % MINUTES_PER_DAY === 0 &&
        m >= CHAT_OPEN_BEFORE_DAYS_MIN * MINUTES_PER_DAY &&
        m <= CHAT_OPEN_BEFORE_DAYS_MAX * MINUTES_PER_DAY),
    { message: "chatOpenBeforeMinutes must be 30 or 1-30 days" },
  )
  .nullable();

/** 終わりの値: CHAT_CLOSE_AFTER_OPTIONS のどれか */
export const chatCloseAfterMinutesSchema = z
  .number()
  .int()
  .refine(
    (m) => (CHAT_CLOSE_AFTER_OPTIONS as readonly number[]).includes(m),
    { message: "chatCloseAfterMinutes must be one of the options" },
  );

/** 書き込める期間（epoch ms）。opensAt が null なら下限なし */
export interface ChatWriteWindow {
  opensAt: number | null;
  closesAt: number;
}

/** 期間の計算に要るイベントの項目 */
export interface ChatWriteWindowSettings {
  startsAt: number;
  endsAt: number;
  chatOpenBeforeMinutes: number | null;
  chatCloseAfterMinutes: number;
}

/** イベントの書き込める期間。web の入力欄とサーバーの chat 系ペイロードが同じ関数を使う */
export function chatWriteWindow(event: ChatWriteWindowSettings): ChatWriteWindow {
  return {
    opensAt:
      event.chatOpenBeforeMinutes === null
        ? null
        : event.startsAt - event.chatOpenBeforeMinutes * 60_000,
    closesAt: event.endsAt + event.chatCloseAfterMinutes * 60_000,
  };
}

/** いま書き込めるか（境界はどちらも含む） */
export function isChatWritable(
  event: ChatWriteWindowSettings,
  now: number,
): boolean {
  return isWithinChatWriteWindow(chatWriteWindow(event), now);
}

/** 計算済みの期間に now が入っているか（境界はどちらも含む） */
export function isWithinChatWriteWindow(
  window: ChatWriteWindow,
  now: number,
): boolean {
  return (window.opensAt === null || now >= window.opensAt) && now <= window.closesAt;
}

/** 1メッセージの最大文字数 */
export const CHAT_MESSAGE_MAX = 500;

/** kind:40 チャンネル作成イベントの about（主催者NIP-07・公式鍵どちらの経路でも同一） */
export const CHAT_CHANNEL_ABOUT = "events lab のイベントチャット";

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
  /** イベントでのロール（staff の発言を色分け表示するため #228）。行が無ければ null */
  role: z.string().nullable(),
});
export type ChatMember = z.infer<typeof chatMemberSchema>;

/** GET /events/:id/chat-members のレスポンス */
export interface ChatMembersPayload {
  members: ChatMember[];
  channelId: string | null;
  chatEnabled: boolean;
  hiddenNoteIds: string[];
  /** 非表示・解除を開いている画面へ即時に届ける合図の購読先（D-POLL-MIN 第5段階）。
   * 公式サービス鍵が未設定なら null */
  hiddenSignal: EventSignalConfig | null;
  /** 読み書きに使うリレー（運用設定。未設定なら CHAT_RELAYS） */
  relays: string[];
  /** 書き込める期間 (#578)。サーバーが chatWriteWindow で計算する。
   * 入力欄の判定用で、表示の絞り込みには使わない */
  writeWindow: ChatWriteWindow;
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
