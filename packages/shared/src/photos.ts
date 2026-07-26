import { z } from "zod";

/** イベントフォト（参加者がアップロード。閲覧も参加者のみ） */
export const eventPhotoSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  /** 投稿者の表示情報（一覧表示用） */
  userName: z.string(),
  userAvatarUrl: z.string().nullable(),
  /** この写真へのコメント数（サムネのオーバーレイ表示用） */
  commentCount: z.number(),
  createdAt: z.number(),
});
export type EventPhoto = z.infer<typeof eventPhotoSchema>;

/** 写真へのコメント */
export const photoCommentSchema = z.object({
  id: z.string(),
  photoId: z.string(),
  userId: z.string(),
  userName: z.string(),
  userAvatarUrl: z.string().nullable(),
  username: z.string().nullable(),
  body: z.string(),
  createdAt: z.number(),
});
export type PhotoComment = z.infer<typeof photoCommentSchema>;

export const createPhotoCommentInput = z.object({
  body: z.string().trim().min(1).max(1000),
});
export type CreatePhotoCommentInput = z.infer<typeof createPhotoCommentInput>;

/** 公開プロフィールのギャラリー用（公開設定イベントに投稿した写真） */
export const userPhotoSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventTitle: z.string(),
  commentCount: z.number(),
  createdAt: z.number(),
});
export type UserPhoto = z.infer<typeof userPhotoSchema>;

/** 1イベントあたりの上限枚数（いたずら対策） */
export const EVENT_PHOTO_LIMIT = 50;
/** 1枚あたりのコメント上限件数（いたずら対策） */
export const PHOTO_COMMENT_LIMIT = 100;
/** 1枚あたりの上限バイト数（クライアント側でWebP圧縮後） */
export const EVENT_PHOTO_MAX_BYTES = 6 * 1024 * 1024;
