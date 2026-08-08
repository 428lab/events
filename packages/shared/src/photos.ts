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
  body: z.string().trim().min(1).max(200),
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

/** 公開プロフィールの年表に添えるサムネイル1枚 (#315)。
 * 出どころは userPhotoSchema と同じ（本人が公開設定イベントに投稿した写真）で、
 * 年表では枚数を絞るので eventTitle 等は持たせない。
 * commentCount は並び順（多い順）を決めるためだけに使い、画面には出さない */
export const timelinePhotoSchema = z.object({
  id: z.string(),
  commentCount: z.number(),
});
export type TimelinePhoto = z.infer<typeof timelinePhotoSchema>;

/** イベント1件ぶんの年表用サムネイル (#315) */
export const eventTimelinePhotosSchema = z.object({
  eventId: z.string(),
  /** コメントが多い順の上位数枚 */
  photos: z.array(timelinePhotoSchema),
  /** そのイベントの公開写真の総数（「+N」の残枚数表示に使う） */
  total: z.number(),
});
export type EventTimelinePhotos = z.infer<typeof eventTimelinePhotosSchema>;

/** 年表のカード1枚に並べるサムネイルの上限 (#315)。
 * これを超える分は「+N」だけ出す */
export const TIMELINE_PHOTOS_PER_EVENT = 3;

/** 1イベントあたりの上限枚数（いたずら対策） */
export const EVENT_PHOTO_LIMIT = 50;
/** 1枚あたりのコメント上限件数（いたずら対策） */
export const PHOTO_COMMENT_LIMIT = 100;
/** 1枚あたりの上限バイト数。クライアントは長辺1600px/WebP画質0.8に縮小して
 * 送るため通常はごく小さい。これを超えるものはサーバーが拒否（縮小はしない）。 */
export const EVENT_PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;
