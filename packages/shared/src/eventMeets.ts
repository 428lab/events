import { z } from "zod";

/** 出会った記録 (#189)。プロフィールQRの読み合いでお互いにXPが入る */

/** 出会った相手（同じイベントの確定メンバー）を指定する入力 */
export const recordMeetInput = z.object({
  /** 相手のユーザーID */
  userId: z.string().min(1),
});
export type RecordMeetInput = z.infer<typeof recordMeetInput>;

/** いま「出会った」を記録できる共通イベント（両者が対象メンバーの開催中イベント） */
export const meetableEventSchema = z.object({
  id: z.string(),
  title: z.string(),
});
export type MeetableEvent = z.infer<typeof meetableEventSchema>;
