import { z } from "zod";

/** アプリ内通知の種別 */
export const NOTIFICATION_TYPES = [
  "lottery_won",
  "lottery_lost",
  "waitlist_promoted",
  "award",
  "inquiry_reply",
  "inquiry_new",
  "schedule_finalized",
  "request_event_created",
  "followee_created_event",
  "followee_joined_event",
  "venue_offer",
  "venue_offer_result",
  "venue_photo_result",
  "survey_reminder",
  "meet",
  /** 異常行動の検知バッチが要確認を記録したときの運営向け通知 (#259) */
  "abuse_flag",
  /** スタッフからの一斉連絡 (#172) */
  "event_broadcast",
  "info",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  /** クリック時の遷移先（アプリ内パス）。空なら遷移なし */
  link: z.string(),
  read: z.boolean(),
  createdAt: z.number(),
});
export type Notification = z.infer<typeof notificationSchema>;
