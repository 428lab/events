import { z } from "zod";
import { myEventSummary } from "./schema.js";

/** 公開ユーザープロフィール（誰でも閲覧可） */
export const userProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.number(),
  events: z.array(myEventSummary),
});
export type UserProfile = z.infer<typeof userProfileSchema>;
