import { z } from "zod";
import { myEventSummary } from "./schema.js";

/** 公開ユーザープロフィール（誰でも閲覧可） */
export const userProfileSchema = z.object({
  id: z.string(),
  handle: z.string().optional(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.number(),
  events: z.array(myEventSummary),
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
