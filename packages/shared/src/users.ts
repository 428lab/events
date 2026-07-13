import { z } from "zod";
import { myEventSummary } from "./schema.js";
import { communitySummarySchema } from "./communities.js";

/** 受賞歴の1件（公開プロフィール用。終了済み公開イベントのみ） */
export const userAwardSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string(),
  /** イベント終了日時（表示・並び順用） */
  endsAt: z.number(),
  /** 賞の名前（例: 最優秀賞、オーディエンス賞） */
  awardName: z.string(),
  /** 受賞した Entry 名（チーム名 or 本人名） */
  entryName: z.string(),
  /** ランキング賞なら順位（1が最上位）。特別枠は null */
  rankOrder: z.number().nullable(),
});
export type UserAward = z.infer<typeof userAwardSchema>;

/** 公開ユーザープロフィール（誰でも閲覧可） */
export const userProfileSchema = z.object({
  id: z.string(),
  handle: z.string().optional(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.number(),
  events: z.array(myEventSummary),
  communities: z.array(communitySummarySchema),
  awards: z.array(userAwardSchema),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** ユーザー名（プロフィールURLのハンドル）の変更入力。URL安全な文字のみ・2〜32文字 */
export const updateUsernameInput = z.object({
  username: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9_.-]{2,32}$/,
      "半角英数字と _ . - のみ、2〜32文字で入力してください",
    ),
});
export type UpdateUsernameInput = z.infer<typeof updateUsernameInput>;
