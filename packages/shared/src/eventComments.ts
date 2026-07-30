import { z } from "zod";

/** イベントへのコメント（参加確定者が投稿。閲覧はイベントが見える人） */
export const eventCommentSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  userName: z.string(),
  userAvatarUrl: z.string().nullable(),
  username: z.string().nullable(),
  body: z.string(),
  createdAt: z.number(),
});
export type EventComment = z.infer<typeof eventCommentSchema>;

export const createEventCommentInput = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type CreateEventCommentInput = z.infer<typeof createEventCommentInput>;

/** 1イベントあたりのコメント上限件数（いたずら対策） */
export const EVENT_COMMENT_LIMIT = 200;
