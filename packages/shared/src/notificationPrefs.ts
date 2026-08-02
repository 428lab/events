import { z } from "zod";

/** 通知設定 (#21 PR3, #126 でメール追加) */
export const notificationPrefsSchema = z.object({
  /** フォロー相手がイベントを公開したときの通知 */
  followeeCreated: z.boolean(),
  /** フォロー相手がイベントに参加したときの通知 */
  followeeJoined: z.boolean(),
  /** アプリ内通知をメールでも受け取る（前日リマインダー含む） (#126) */
  emailEnabled: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const updateNotificationPrefsInput = notificationPrefsSchema.partial();
export type UpdateNotificationPrefsInput = z.infer<
  typeof updateNotificationPrefsInput
>;
