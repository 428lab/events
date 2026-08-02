import type {
  NotificationPrefs,
  UpdateNotificationPrefsInput,
} from "@eventer/shared";
import { one, run } from "../client.js";

/** 通知設定 (#21 PR3)。行が無ければ既定値（フォロー通知ON・メールOFF） */
export const notificationPrefsRepo = {
  async get(userId: string): Promise<NotificationPrefs> {
    const row = await one<{
      followee_created: number;
      followee_joined: number;
      email_enabled: number;
    }>(
      "SELECT followee_created, followee_joined, email_enabled FROM notification_pref WHERE user_id = ?",
      userId,
    );
    return {
      followeeCreated: row ? row.followee_created === 1 : true,
      followeeJoined: row ? row.followee_joined === 1 : true,
      emailEnabled: row ? row.email_enabled === 1 : false,
    };
  },

  async update(
    userId: string,
    input: UpdateNotificationPrefsInput,
  ): Promise<NotificationPrefs> {
    const current = await this.get(userId);
    const next = { ...current, ...input };
    await run(
      `INSERT INTO notification_pref (user_id, followee_created, followee_joined, email_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         followee_created = excluded.followee_created,
         followee_joined = excluded.followee_joined,
         email_enabled = excluded.email_enabled,
         updated_at = excluded.updated_at`,
      userId,
      next.followeeCreated ? 1 : 0,
      next.followeeJoined ? 1 : 0,
      next.emailEnabled ? 1 : 0,
      Date.now(),
    );
    return next;
  },
};
