import { z } from "zod";

/** 通知設定 (#21 PR3)。メール(emailEnabled)は送信基盤導入(PR4)まで UI 非表示 */
export const notificationPrefsSchema = z.object({
  /** フォロー相手がイベントを公開したときの通知 */
  followeeCreated: z.boolean(),
  /** フォロー相手がイベントに参加したときの通知 */
  followeeJoined: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const updateNotificationPrefsInput = notificationPrefsSchema.partial();
export type UpdateNotificationPrefsInput = z.infer<
  typeof updateNotificationPrefsInput
>;
