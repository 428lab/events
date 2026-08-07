import { z } from "zod";
import { chatMemberSchema } from "./eventChat.js";

/** 運営によるイベント内コンテンツの非表示 (#278)。
 *
 * イベント内コンテンツの削除は「そのイベントのスタッフだけ」に絞ってある (#275)。
 * 終了済みイベントには参加登録もスタッフ追加もできないので、終了後に違反コンテンツが
 * 投稿されてスタッフが動かない場合に誰も対処できなくなる。その穴を埋めるための、
 * 管理ダッシュボード専用の経路。
 *
 * **削除ではなく非表示**。データは残し、誤って対処しても復元できる。
 * 対処・復元はどちらも監査ログ (#248) に残る。 */

/** 対処できるコンテンツの種類 */
export const MODERATION_KINDS = [
  "photo",
  "photo_comment",
  "event_comment",
  "question",
  "chat_message",
] as const;
export type ModerationKind = (typeof MODERATION_KINDS)[number];

/** items（下の moderationItemSchema）に載る種類。
 * チャットは本文も投稿者もサーバーに無く、ブラウザがリレーから直接読むので
 * items ではなく chat.hidden 側に出る。**chat_message はここに入らない** */
export const MODERATION_ITEM_KINDS = [
  "photo",
  "photo_comment",
  "event_comment",
  "question",
] as const;
export type ModerationItemKind = (typeof MODERATION_ITEM_KINDS)[number];

/** 画面表示用の日本語ラベル */
export const MODERATION_KIND_LABELS: Record<ModerationKind, string> = {
  photo: "写真",
  photo_comment: "写真へのコメント",
  event_comment: "イベントのコメント",
  question: "Q&A の質問",
  chat_message: "チャットのメッセージ",
};

/** 対処の対象1件（DB に行があるもの＝チャット以外）。
 * 本文は写真だけ null で、画像そのものを見て判断する。
 *
 * 投稿者は退会・統合でユーザー行が消えることがあるので、
 * 表示は authorHandle が空でも壊れないようにすること。 */
export const moderationItemSchema = z.object({
  kind: z.enum(MODERATION_ITEM_KINDS),
  /** 写真コメントは写真コメントのID、それ以外は行のID */
  id: z.string(),
  /** 写真コメントがぶら下がっている写真のID（それ以外は null） */
  photoId: z.string().nullable(),
  /** 本文。写真は null（画像そのものを見て判断する） */
  body: z.string().nullable(),
  /** 投稿者。ユーザー行が消えている場合に備えて null 許容 */
  authorUserId: z.string().nullable(),
  authorHandle: z.string(),
  authorName: z.string(),
  /** 投稿日時（ミリ秒） */
  createdAt: z.number(),
  /** 運営が非表示にした日時。null なら運営は対処していない */
  hiddenAt: z.number().nullable(),
  /** 対処した運営管理者の user id */
  hiddenBy: z.string().nullable(),
  /** そのイベントのスタッフも非表示にしている（Q&A のみ）。
   * 運営の対処とは別系統なので区別して表示する。
   * 運営が対処したあとも、**対処する前にスタッフが非表示にしていたか** を出す
   * （運営の復元はスタッフの非表示までは取り消さないため） */
  staffHidden: z.boolean(),
});
export type ModerationItem = z.infer<typeof moderationItemSchema>;

/** 対処対象を選ぶための、イベントの見出しだけの情報 */
export const moderationEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  startsAt: z.number(),
  endsAt: z.number(),
  /** 主催者のハンドル（誰のイベントかの手がかり） */
  hostHandle: z.string(),
});
export type ModerationEvent = z.infer<typeof moderationEventSchema>;

/** GET /api/admin/moderation/events?userId=&q= のレスポンス */
export const moderationEventsPayloadSchema = z.object({
  events: z.array(moderationEventSchema),
  /** limit で打ち切ったか（絞り込みを促すため） */
  truncated: z.boolean(),
});
export type ModerationEventsPayload = z.infer<
  typeof moderationEventsPayloadSchema
>;

/** チャットは本文がサーバーに無く、外部にも公開されている。
 * 管理画面はチャンネルIDとリレーだけを渡し、本文はブラウザが直接取りに行く。 */
export const moderationChatSchema = z.object({
  /** チャットが使われていない（部屋が無い）イベントは null */
  channelId: z.string().nullable(),
  relays: z.array(z.string()),
  /** 公開鍵 → 発言者の対応。誰の発言かを画面に出すために使う */
  members: z.array(chatMemberSchema),
  /** 非表示にしている note の一覧（運営・スタッフの両方） */
  hidden: z.array(
    z.object({
      noteId: z.string(),
      hiddenAt: z.number().nullable(),
      hiddenBy: z.string().nullable(),
      /** そのイベントのスタッフも非表示にしている。
       * 運営が対処したあとも、**対処する前にスタッフが非表示にしていたか** を出す
       * （運営の復元はスタッフの非表示までは取り消さないため） */
      staffHidden: z.boolean(),
    }),
  ),
});
export type ModerationChat = z.infer<typeof moderationChatSchema>;

/** GET /api/admin/moderation/events/:eventId のレスポンス */
export const moderationContentPayloadSchema = z.object({
  event: moderationEventSchema,
  /** 写真・写真コメント・イベントコメント・Q&A をまとめて返す
   * （1イベントぶんなので件数はたかが知れている） */
  items: z.array(moderationItemSchema),
  chat: moderationChatSchema,
});
export type ModerationContentPayload = z.infer<
  typeof moderationContentPayloadSchema
>;

/** POST /api/admin/moderation/events/:eventId/hide
 *  POST /api/admin/moderation/events/:eventId/restore */
export const moderationActionInput = z.object({
  kind: z.enum(MODERATION_KINDS),
  id: z.string().min(1),
});
export type ModerationActionInput = z.infer<typeof moderationActionInput>;

/** 対処対象を探すときに返すイベントの上限件数（新しい順にこの件数まで）。
 *
 * 期間では絞らない。モデレーションの道具が候補を黙って隠すと、1年前のイベントに
 * 投稿された違反コンテンツが運営には「対象なし」に見えてしまう。
 * 代わりに件数で打ち切り、打ち切ったことは truncated で画面に伝える。 */
export const MODERATION_EVENT_LIMIT = 50;
