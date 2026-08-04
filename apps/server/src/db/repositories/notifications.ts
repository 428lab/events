import type { Notification, NotificationType } from "@eventer/shared";
import { batch, many, one, run } from "../client.js";
import { deferBackground } from "../../runtime.js";
import {
  sendNotificationEmailIfOptedIn,
  sendNotificationEmailTo,
  type EmailExtras,
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
    // メール表示のみに使う付加情報 (#134)。DB スキーマは変えない
    extras?: EmailExtras,
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
    // メール通知ONのユーザーには同内容をメールでも送る (#126)。
    // レスポンスをブロックしないよう waitUntil に逃がす（失敗しても通知作成は成功扱い）
    await deferBackground(
      sendNotificationEmailIfOptedIn(userId, title, body, link, extras),
    );
  },

  /** 複数ユーザーへ同一内容の通知を作成（抽選・表彰・フォロワー通知の一斉配信用）。
   * 1人1クエリだとサブリクエスト上限とレイテンシに響くため、D1 batch でまとめて挿入 */
  async createForMany(
    userIds: string[],
    type: NotificationType,
    title: string,
    body = "",
    link = "",
    // メール表示のみに使う付加情報 (#134)。DB スキーマは変えない
    extras?: EmailExtras,
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
    // メール通知ONのユーザーへも配信 (#126)。上限つき・waitUntil でレスポンス外に逃がす
    await deferBackground(
      (async () => {
        try {
          const recipients = await emailRepo.findRecipientsAmong(userIds);
          if (recipients.length > MAX_BULK_EMAILS) {
            console.warn(
              `email: 一斉通知のメール対象 ${recipients.length} 件中 ${MAX_BULK_EMAILS} 件のみ送信`,
            );
          }
          for (const r of recipients.slice(0, MAX_BULK_EMAILS)) {
            await sendNotificationEmailTo(
              r.userId,
              r.email,
              title,
              body,
              link,
              extras,
            );
          }
        } catch (e) {
          console.warn("email: 一斉通知のメール送信に失敗", e);
        }
      })(),
    );
  },

  /** 退会申請 (#250) したユーザーが「した側」として生成した通知を削除する。
   *
   * follow 起点の通知と meet 通知はタイトルに「◯◯ さんが…」と表示名を焼き込んで
   * いるため、行が残っているとフォロワー／同席者の通知一覧に名前が出続ける
   * （#244 の完全削除でも notification.user_id は受信者なので消えない）。
   * notification テーブルには actor 列が無いので、種別ごとに actor を特定できる
   * 条件で消す:
   *   - meet                    : link が actor 本人のプロフィールURL
   *   - followee_created_event  : link 先のイベントの created_by が actor
   *   - followee_joined_event   : actor が参加しているイベント かつ タイトルが
   *                               actor の表示名で始まる（同じイベントに参加した
   *                               別のフォロイーの通知を巻き込まないため）
   *
   * 復帰しても通知は戻らない。通知は流れていく性質のもので、履歴として復元する
   * 価値より猶予期間中に名前が見え続ける不利益のほうが大きいと判断した。
   * D1 batch なのでサブリクエストは1つ。 */
  async deleteByActor(actor: {
    id: string;
    username: string;
    globalName: string | null;
  }): Promise<void> {
    // LIKE のワイルドカード (% _) を含む表示名で広く消しすぎないようエスケープ
    const likePrefix = (name: string) =>
      `${name.replace(/[\\%_]/g, (c) => `\\${c}`)} さんが%`;
    const names = [actor.globalName, actor.username].filter(
      (n): n is string => !!n,
    );
    await batch([
      {
        sql: "DELETE FROM notification WHERE type = 'meet' AND link = ?",
        args: [`/users/${encodeURIComponent(actor.username)}`],
      },
      {
        sql: `DELETE FROM notification WHERE type = 'followee_created_event'
                AND link IN (SELECT '/events/' || id FROM event WHERE created_by = ?)`,
        args: [actor.id],
      },
      {
        sql: `DELETE FROM notification WHERE type = 'followee_joined_event'
                AND (${names.map(() => "title LIKE ? ESCAPE '\\'").join(" OR ")})
                AND link IN (SELECT '/events/' || event_id FROM event_member WHERE user_id = ?)`,
        args: [...names.map(likePrefix), actor.id],
      },
    ]);
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
