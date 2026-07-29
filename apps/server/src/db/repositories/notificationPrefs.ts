import type {
  NotificationPrefs,
  UpdateNotificationPrefsInput,
} from "@eventer/shared";
import { one, run } from "../client.js";

/** 通知設定 (#21 PR3)。行が無ければ既定値（フォロー通知ON） */
export const notificationPrefsRepo = {
  async get(userId: string): Promise<NotificationPrefs> {
    const row = await one<{
      followee_created: number;
      followee_joined: number;
    }>(
      "SELECT followee_created, followee_joined FROM notification_pref WHERE user_id = ?",
      userId,
    );
    return {
      followeeCreated: row ? row.followee_created === 1 : true,
      followeeJoined: row ? row.followee_joined === 1 : true,
    };
  },

  async update(
    userId: string,
    input: UpdateNotificationPrefsInput,
  ): Promise<NotificationPrefs> {
    const current = await this.get(userId);
    const next = { ...current, ...input };
    await run(
      `INSERT INTO notification_pref (user_id, followee_created, followee_joined, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         followee_created = excluded.followee_created,
         followee_joined = excluded.followee_joined,
         updated_at = excluded.updated_at`,
      userId,
      next.followeeCreated ? 1 : 0,
      next.followeeJoined ? 1 : 0,
      Date.now(),
    );
    return next;
  },
};
