import type { Notification, NotificationType } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read_at: number;
  created_at: number;
}

function toNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.read_at > 0,
    createdAt: r.created_at,
  };
}

export const notificationsRepo = {
  async create(
    userId: string,
    type: NotificationType,
    title: string,
    body = "",
    link = "",
  ): Promise<void> {
    await run(
      `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      crypto.randomUUID(),
      userId,
      type,
      title,
      body,
      link,
      Date.now(),
    );
  },

  /** 複数ユーザーへ同一内容の通知を作成（抽選・表彰の一斉通知用） */
  async createForMany(
    userIds: string[],
    type: NotificationType,
    title: string,
    body = "",
    link = "",
  ): Promise<void> {
    for (const userId of userIds) {
      await this.create(userId, type, title, body, link);
    }
  },

  async listByUser(userId: string, limit = 40): Promise<Notification[]> {
    const rows = await many<NotificationRow>(
      "SELECT * FROM notification WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      userId,
      limit,
    );
    return rows.map(toNotification);
  },

  async unreadCount(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ? AND read_at = 0",
      userId,
    );
    return row?.n ?? 0;
  },

  async markRead(id: string, userId: string): Promise<void> {
    await run(
      "UPDATE notification SET read_at = ? WHERE id = ? AND user_id = ? AND read_at = 0",
      Date.now(),
      id,
      userId,
    );
  },

  async markAllRead(userId: string): Promise<void> {
    await run(
      "UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at = 0",
      Date.now(),
      userId,
    );
  },
};
