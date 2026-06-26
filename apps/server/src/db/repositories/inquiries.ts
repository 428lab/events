import type {
  AdminInquiry,
  Inquiry,
  InquiryDetail,
  InquiryMessage,
  InquiryStatus,
} from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

interface InquiryRow {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  created_at: number;
  last_message_at: number;
  last_sender: string;
  user_read_at: number;
  admin_read_at: number;
}

interface MessageRow {
  id: string;
  sender: string;
  body: string;
  created_at: number;
}

function toMessage(r: MessageRow): InquiryMessage {
  return {
    id: r.id,
    sender: r.sender as "user" | "admin",
    body: r.body,
    createdAt: r.created_at,
  };
}

/** viewer="user": 運営からの新着が未読 / viewer="admin": ユーザーからの新着が未読 */
function toInquiry(r: InquiryRow, viewer: "user" | "admin"): Inquiry {
  const unread =
    viewer === "user"
      ? r.last_sender === "admin" && r.last_message_at > r.user_read_at
      : r.last_sender === "user" && r.last_message_at > r.admin_read_at;
  return {
    id: r.id,
    subject: r.subject,
    status: r.status as InquiryStatus,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
    lastSender: r.last_sender as "user" | "admin",
    unread,
  };
}

export const inquiriesRepo = {
  async create(
    userId: string,
    subject: string,
    body: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await batch([
      {
        sql: `INSERT INTO inquiry
                (id, user_id, subject, status, created_at, last_message_at,
                 last_sender, user_read_at, admin_read_at)
              VALUES (?, ?, ?, 'open', ?, ?, 'user', ?, 0)`,
        args: [id, userId, subject, now, now, now],
      },
      {
        sql: `INSERT INTO inquiry_message (id, inquiry_id, sender, body, created_at)
              VALUES (?, ?, 'user', ?, ?)`,
        args: [crypto.randomUUID(), id, body, now],
      },
    ]);
    return id;
  },

  async listByUser(userId: string): Promise<Inquiry[]> {
    const rows = await many<InquiryRow>(
      "SELECT * FROM inquiry WHERE user_id = ? ORDER BY last_message_at DESC",
      userId,
    );
    return rows.map((r) => toInquiry(r, "user"));
  },

  async userUnreadCount(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n FROM inquiry
       WHERE user_id = ? AND last_sender = 'admin' AND last_message_at > user_read_at`,
      userId,
    );
    return row?.n ?? 0;
  },

  /** ユーザー本人の問い合わせ詳細。閲覧で user_read_at を更新。所有者でなければ null */
  async getForUser(
    id: string,
    userId: string,
  ): Promise<InquiryDetail | null> {
    const inq = await one<InquiryRow>(
      "SELECT * FROM inquiry WHERE id = ? AND user_id = ?",
      id,
      userId,
    );
    if (!inq) return null;
    await run("UPDATE inquiry SET user_read_at = ? WHERE id = ?", Date.now(), id);
    return this.detail(inq);
  },

  /** 返信を追加。成功時は運営宛て通知用に件名を返す。所有者でなければ null */
  async addUserMessage(
    id: string,
    userId: string,
    body: string,
  ): Promise<{ subject: string } | null> {
    const inq = await one<{ subject: string }>(
      "SELECT subject FROM inquiry WHERE id = ? AND user_id = ?",
      id,
      userId,
    );
    if (!inq) return null;
    const now = Date.now();
    await batch([
      {
        sql: `INSERT INTO inquiry_message (id, inquiry_id, sender, body, created_at)
              VALUES (?, ?, 'user', ?, ?)`,
        args: [crypto.randomUUID(), id, body, now],
      },
      {
        sql: `UPDATE inquiry SET last_message_at = ?, last_sender = 'user',
                status = 'open', user_read_at = ? WHERE id = ?`,
        args: [now, now, id],
      },
    ]);
    return { subject: inq.subject };
  },

  // ===== 運営 =====
  async listAll(): Promise<AdminInquiry[]> {
    const rows = await many<
      InquiryRow & { u_name: string | null; u_username: string; u_avatar: string | null }
    >(
      `SELECT i.*, u.global_name AS u_name, u.username AS u_username,
              u.avatar_url AS u_avatar
       FROM inquiry i JOIN user u ON u.id = i.user_id
       ORDER BY i.last_message_at DESC`,
    );
    return rows.map((r) => ({
      ...toInquiry(r, "admin"),
      userName: r.u_name ?? r.u_username,
      userAvatarUrl: r.u_avatar,
    }));
  },

  async adminUnreadCount(): Promise<number> {
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n FROM inquiry
       WHERE last_sender = 'user' AND last_message_at > admin_read_at`,
    );
    return row?.n ?? 0;
  },

  async getForAdmin(id: string): Promise<InquiryDetail | null> {
    const inq = await one<
      InquiryRow & { u_name: string | null; u_username: string }
    >(
      `SELECT i.*, u.global_name AS u_name, u.username AS u_username
       FROM inquiry i JOIN user u ON u.id = i.user_id WHERE i.id = ?`,
      id,
    );
    if (!inq) return null;
    await run("UPDATE inquiry SET admin_read_at = ? WHERE id = ?", Date.now(), id);
    const detail = await this.detail(inq);
    return { ...detail, userName: inq.u_name ?? inq.u_username };
  },

  /** 返信を追加。成功時は通知用に問い合わせ主の userId と件名を返す */
  async addAdminMessage(
    id: string,
    body: string,
  ): Promise<{ userId: string; subject: string } | null> {
    const inq = await one<{ user_id: string; subject: string }>(
      "SELECT user_id, subject FROM inquiry WHERE id = ?",
      id,
    );
    if (!inq) return null;
    const now = Date.now();
    await batch([
      {
        sql: `INSERT INTO inquiry_message (id, inquiry_id, sender, body, created_at)
              VALUES (?, ?, 'admin', ?, ?)`,
        args: [crypto.randomUUID(), id, body, now],
      },
      {
        sql: `UPDATE inquiry SET last_message_at = ?, last_sender = 'admin',
                status = 'answered', admin_read_at = ? WHERE id = ?`,
        args: [now, now, id],
      },
    ]);
    return { userId: inq.user_id, subject: inq.subject };
  },

  async detail(inq: InquiryRow): Promise<InquiryDetail> {
    const msgs = await many<MessageRow>(
      "SELECT id, sender, body, created_at FROM inquiry_message WHERE inquiry_id = ? ORDER BY created_at ASC",
      inq.id,
    );
    return {
      id: inq.id,
      subject: inq.subject,
      status: inq.status as InquiryStatus,
      messages: msgs.map(toMessage),
    };
  },
};
