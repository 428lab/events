import { z } from "zod";

/** イベントフォト（参加者がアップロード。閲覧も参加者のみ） */
export const eventPhotoSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  /** 投稿者の表示情報（一覧表示用） */
  userName: z.string(),
  userAvatarUrl: z.string().nullable(),
  createdAt: z.number(),
});
export type EventPhoto = z.infer<typeof eventPhotoSchema>;

/** 1イベントあたりの上限枚数 */
export const EVENT_PHOTO_LIMIT = 500;
/** 1枚あたりの上限バイト数（クライアント側でWebP圧縮後） */
export const EVENT_PHOTO_MAX_BYTES = 6 * 1024 * 1024;
