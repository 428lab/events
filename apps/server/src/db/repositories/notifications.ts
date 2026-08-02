import type { Notification, NotificationType } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";
import {
  sendNotificationEmailIfOptedIn,
  sendNotificationEmailTo,
} from "../../lib/email.js";
import { emailRepo } from "./email.js";

/** createForMany 1回あたりのメール送信上限（サブリクエスト数の安全上限） */
const MAX_BULK_EMAILS = 50;

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
    // メール通知ONのユーザーには同内容をメールでも送る (#126)。失敗しても通知作成は成功扱い
    await sendNotificationEmailIfOptedIn(userId, title, body, link);
  },

  /** 複数ユーザーへ同一内容の通知を作成（抽選・表彰・フォロワー通知の一斉配信用）。
   * 1人1クエリだとサブリクエスト上限とレイテンシに響くため、D1 batch でまとめて挿入 */
  async createForMany(
    userIds: string[],
    type: NotificationType,
    title: string,
    body = "",
    link = "",
  ): Promise<void> {
    const now = Date.now();
    const CHUNK = 50;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      await batch(
        userIds.slice(i, i + CHUNK).map((userId) => ({
          sql: `INSERT INTO notification (id, user_id, type, title, body, link, read_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          args: [crypto.randomUUID(), userId, type, title, body, link, now],
        })),
      );
    }
    // メール通知ONのユーザーへも配信 (#126)。上限つき・失敗しても通知作成は成功扱い
    try {
      const recipients = await emailRepo.findRecipientsAmong(userIds);
      if (recipients.length > MAX_BULK_EMAILS) {
        console.warn(
          `email: 一斉通知のメール対象 ${recipients.length} 件中 ${MAX_BULK_EMAILS} 件のみ送信`,
        );
      }
      for (const r of recipients.slice(0, MAX_BULK_EMAILS)) {
        await sendNotificationEmailTo(r.userId, r.email, title, body, link);
      }
    } catch (e) {
      console.warn("email: 一斉通知のメール送信に失敗", e);
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
