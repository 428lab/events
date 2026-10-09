import type {
  AdminInquiry,
  Inquiry,
  InquiryDetail,
  InquiryEvent,
  InquiryMessage,
  InquirySender,
  InquiryStatus,
} from "@eventer/shared";
import { eventViewSql } from "../../auth/eventAccess.js";
import { batch, many, one, run } from "../client.js";
import { adminIds } from "./eventAccessInvites.js";
import { eventRun, eventWrite } from "./eventWriteGuard.js";

interface InquiryRow {
  id: string;
  user_id: string;
  event_id: string | null;
  subject: string;
  status: string;
  created_at: number;
  last_message_at: number;
  last_sender: string;
  user_read_at: number;
  admin_read_at: number;
}

/** イベントの主催者あての問い合わせ (D-EVENT-CONTACT) を読むときに、イベント名を添えた行 */
type InquiryWithEventRow = InquiryRow & { e_title: string | null };

interface MessageRow {
  id: string;
  sender: string;
  body: string;
  created_at: number;
}

function toMessage(r: MessageRow): InquiryMessage {
  return {
    id: r.id,
    sender: r.sender as InquirySender,
    body: r.body,
    createdAt: r.created_at,
  };
}

function toEvent(r: InquiryWithEventRow | InquiryRow): InquiryEvent | null {
  const title = (r as InquiryWithEventRow).e_title;
  return r.event_id && title != null ? { id: r.event_id, title } : null;
}

/** viewer="user": 運営・主催者からの新着が未読 / viewer="admin": ユーザーからの新着が未読。
 * イベントの主催者側（確定スタッフ）も "admin" 視点で読む（admin_read_at を主催者側の既読に使う） */
function toInquiry(r: InquiryRow, viewer: "user" | "admin"): Inquiry {
  const unread =
    viewer === "user"
      ? r.last_sender !== "user" && r.last_message_at > r.user_read_at
      : r.last_sender === "user" && r.last_message_at > r.admin_read_at;
  return {
    id: r.id,
    subject: r.subject,
    status: r.status as InquiryStatus,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
    lastSender: r.last_sender as InquirySender,
    unread,
    event: toEvent(r),
  };
}

/**
 * 問い合わせた本人に見せてよい行の条件（`i` = inquiry、`e` = LEFT JOIN した event、?1 = 管理者の
 * JSON、?2 = 本人の user id）。運営あて（event_id IS NULL）はいつでも、イベントの主催者あては
 * **いまそのイベントを見られるときだけ**。非公開イベントの閲覧を外された人に、イベント名も
 * やりとりも返さない（外されたことは次に開いたときに効けばよい、という既定の方針どおり）
 */
const USER_VISIBLE_SQL = `(i.event_id IS NULL OR (e.id IS NOT NULL AND ${eventViewSql("e", "?2", "?1")}))`;

/** 運営（アプリ管理者）の画面に出してよい行。イベントの主催者あては主催者と問い合わせた人の
 * 間の話なので、運営には見せない（D-EVENT-CONTACT の決定6） */
const ADMIN_SCOPE_SQL = "i.event_id IS NULL";

type Writer = { eventId: string; actorId: string };

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

  /** イベントの主催者あての問い合わせを作る (D-EVENT-CONTACT)。書き込みはイベントを
   * 見られることを同じ batch の中で確かめる（`view`。参加していなくても送れる） */
  async createForEvent(
    eventId: string,
    userId: string,
    subject: string,
    body: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await eventWrite({ eventId, actorId: userId, permission: "view" }, [
      {
        sql: `INSERT INTO inquiry
                (id, user_id, event_id, subject, status, created_at, last_message_at,
                 last_sender, user_read_at, admin_read_at)
              VALUES (?, ?, ?, ?, 'open', ?, ?, 'user', ?, 0)`,
        args: [id, userId, eventId, subject, now, now, now],
      },
      {
        sql: `INSERT INTO inquiry_message (id, inquiry_id, sender, author_id, body, created_at)
              VALUES (?, ?, 'user', ?, ?, ?)`,
        args: [crypto.randomUUID(), id, userId, body, now],
      },
    ]);
    return id;
  },

  /** その人がそのイベントに出している、未完了（closed 以外）の問い合わせの数 */
  async countOpenForEvent(eventId: string, userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n FROM inquiry
       WHERE user_id = ? AND event_id = ? AND status <> 'closed'`,
      userId,
      eventId,
    );
    return row?.n ?? 0;
  },

  async listByUser(userId: string): Promise<Inquiry[]> {
    const rows = await many<InquiryWithEventRow>(
      `SELECT i.*, e.title AS e_title FROM inquiry i LEFT JOIN event e ON e.id = i.event_id
       WHERE i.user_id = ?2 AND ${USER_VISIBLE_SQL}
       ORDER BY i.last_message_at DESC`,
      adminIds(),
      userId,
    );
    return rows.map((r) => toInquiry(r, "user"));
  },

  async userUnreadCount(userId: string): Promise<number> {
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n FROM inquiry i LEFT JOIN event e ON e.id = i.event_id
       WHERE i.user_id = ?2 AND i.last_sender <> 'user' AND i.last_message_at > i.user_read_at
         AND ${USER_VISIBLE_SQL}`,
      adminIds(),
      userId,
    );
    return row?.n ?? 0;
  },

  /** ユーザー本人の問い合わせ詳細。閲覧で user_read_at を更新。
   * 所有者でない・イベントを見られなくなったなら null */
  async getForUser(
    id: string,
    userId: string,
  ): Promise<InquiryDetail | null> {
    const inq = await this.findForUser(id, userId);
    if (!inq) return null;
    await run("UPDATE inquiry SET user_read_at = ? WHERE id = ?", Date.now(), id);
    return this.detail(inq);
  },

  async findForUser(id: string, userId: string): Promise<InquiryWithEventRow | null> {
    return one<InquiryWithEventRow>(
      `SELECT i.*, e.title AS e_title FROM inquiry i LEFT JOIN event e ON e.id = i.event_id
       WHERE i.id = ?3 AND i.user_id = ?2 AND ${USER_VISIBLE_SQL}`,
      adminIds(),
      userId,
      id,
    );
  },

  /** 返信を追加。成功時は通知用に件名と、イベントの主催者あてならそのイベントを返す。
   * 所有者でない・イベントを見られなくなったなら null */
  async addUserMessage(
    id: string,
    userId: string,
    body: string,
  ): Promise<{ subject: string; event: InquiryEvent | null } | null> {
    const inq = await this.findForUser(id, userId);
    if (!inq) return null;
    const now = Date.now();
    const stmts = [
      {
        sql: `INSERT INTO inquiry_message (id, inquiry_id, sender, author_id, body, created_at)
              VALUES (?, ?, 'user', ?, ?, ?)`,
        args: [crypto.randomUUID(), id, userId, body, now],
      },
      {
        sql: `UPDATE inquiry SET last_message_at = ?, last_sender = 'user',
                status = 'open', user_read_at = ? WHERE id = ?`,
        args: [now, now, id],
      },
    ];
    // イベントの主催者あては、書く時点でもイベントを見られることを同じ batch で確かめる
    if (inq.event_id) await eventWrite({ eventId: inq.event_id, actorId: userId, permission: "view" }, stmts);
    else await batch(stmts);
    return { subject: inq.subject, event: toEvent(inq) };
  },

  // ===== 運営 =====
  // 以下の運営向けクエリは、他の一覧と違って退会申請中 (#250) を除外しない。
  // 問い合わせは運営が対応中の案件で、退会申請と同時に一覧から消えると
  // 対応履歴を追えなくなるため（運営しか見られない画面なので、他ユーザーへ
  // 表示名が漏れることもない）。完全削除時は user 行ごと消えて CASCADE で消える
  async listAll(): Promise<AdminInquiry[]> {
    const rows = await many<
      InquiryRow & { u_name: string | null; u_username: string; u_avatar: string | null }
    >(
      `SELECT i.*, u.global_name AS u_name, u.username AS u_username,
              u.avatar_url AS u_avatar
       FROM inquiry i JOIN user u ON u.id = i.user_id
       WHERE ${ADMIN_SCOPE_SQL}
       ORDER BY i.last_message_at DESC`,
    );
    return rows.map((r) => ({
      ...toInquiry(r, "admin"),
      userId: r.user_id,
      userHandle: r.u_username,
      userName: r.u_name ?? r.u_username,
      userAvatarUrl: r.u_avatar,
    }));
  },

  async adminUnreadCount(): Promise<number> {
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n FROM inquiry i
       WHERE ${ADMIN_SCOPE_SQL} AND i.last_sender = 'user' AND i.last_message_at > i.admin_read_at`,
    );
    return row?.n ?? 0;
  },

  async getForAdmin(id: string): Promise<InquiryDetail | null> {
    const inq = await one<
      InquiryRow & {
        u_name: string | null;
        u_username: string;
        u_avatar: string | null;
      }
    >(
      `SELECT i.*, u.global_name AS u_name, u.username AS u_username,
              u.avatar_url AS u_avatar
       FROM inquiry i JOIN user u ON u.id = i.user_id WHERE i.id = ? AND ${ADMIN_SCOPE_SQL}`,
      id,
    );
    if (!inq) return null;
    await run("UPDATE inquiry SET admin_read_at = ? WHERE id = ?", Date.now(), id);
    const detail = await this.detail(inq);
    return {
      ...detail,
      userId: inq.user_id,
      userHandle: inq.u_username,
      userName: inq.u_name ?? inq.u_username,
      userAvatarUrl: inq.u_avatar,
    };
  },

  /** 返信を追加。成功時は通知用に問い合わせ主の userId と件名を返す */
  async addAdminMessage(
    id: string,
    body: string,
  ): Promise<{ userId: string; subject: string } | null> {
    const inq = await one<{ user_id: string; subject: string }>(
      `SELECT i.user_id, i.subject FROM inquiry i WHERE i.id = ? AND ${ADMIN_SCOPE_SQL}`,
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

  // ===== イベントの主催者（そのイベントの確定スタッフ。D-EVENT-CONTACT） =====
  // 呼び出し側（routes/inquiries.ts の eventInquiryRoutes）が確定スタッフだけを通す。
  // ここでは必ず event_id で絞り、別のイベントの問い合わせに届かないようにする。
  // 退会申請中 (#250) の人の問い合わせは出さない（スタッフは他の利用者なので、
  // 退会を申し出た人の表示名を見せ続けない。他の一覧と同じ扱い）

  async listForEvent(eventId: string): Promise<AdminInquiry[]> {
    const rows = await many<
      InquiryRow & { u_name: string | null; u_username: string; u_avatar: string | null }
    >(
      `SELECT i.*, u.global_name AS u_name, u.username AS u_username,
              u.avatar_url AS u_avatar
       FROM inquiry i JOIN user u ON u.id = i.user_id AND u.deleted_at IS NULL
       WHERE i.event_id = ?
       ORDER BY i.last_message_at DESC`,
      eventId,
    );
    return rows.map((r) => ({
      ...toInquiry(r, "admin"),
      userId: r.user_id,
      userHandle: r.u_username,
      userName: r.u_name ?? r.u_username,
      userAvatarUrl: r.u_avatar,
    }));
  },

  async eventUnreadCount(eventId: string): Promise<number> {
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n FROM inquiry i JOIN user u ON u.id = i.user_id AND u.deleted_at IS NULL
       WHERE i.event_id = ? AND i.last_sender = 'user' AND i.last_message_at > i.admin_read_at`,
      eventId,
    );
    return row?.n ?? 0;
  },

  /** 主催者側の詳細。閲覧で主催者側の既読（admin_read_at）を進める */
  async getForEvent(eventId: string, id: string): Promise<InquiryDetail | null> {
    const inq = await one<
      InquiryWithEventRow & { u_name: string | null; u_username: string; u_avatar: string | null }
    >(
      `SELECT i.*, e.title AS e_title, u.global_name AS u_name, u.username AS u_username,
              u.avatar_url AS u_avatar
       FROM inquiry i JOIN user u ON u.id = i.user_id AND u.deleted_at IS NULL
       JOIN event e ON e.id = i.event_id
       WHERE i.id = ? AND i.event_id = ?`,
      id,
      eventId,
    );
    if (!inq) return null;
    await run("UPDATE inquiry SET admin_read_at = ? WHERE id = ?", Date.now(), id);
    const detail = await this.detail(inq);
    return {
      ...detail,
      userId: inq.user_id,
      userHandle: inq.u_username,
      userName: inq.u_name ?? inq.u_username,
      userAvatarUrl: inq.u_avatar,
    };
  },

  /** スタッフの返信。書く時点でも確定スタッフであることを同じ batch で確かめる。
   * 成功時は通知用に問い合わせた人と件名を返す */
  async addStaffMessage(
    writer: Writer,
    id: string,
    body: string,
  ): Promise<{ userId: string; subject: string } | null> {
    const inq = await one<{ user_id: string; subject: string }>(
      `SELECT i.user_id, i.subject FROM inquiry i JOIN user u ON u.id = i.user_id AND u.deleted_at IS NULL
       WHERE i.id = ? AND i.event_id = ?`,
      id,
      writer.eventId,
    );
    if (!inq) return null;
    const now = Date.now();
    await eventWrite({ ...writer, permission: "staff" }, [
      {
        sql: `INSERT INTO inquiry_message (id, inquiry_id, sender, author_id, body, created_at)
              VALUES (?, ?, 'staff', ?, ?, ?)`,
        args: [crypto.randomUUID(), id, writer.actorId, body, now],
      },
      {
        sql: `UPDATE inquiry SET last_message_at = ?, last_sender = 'staff',
                status = 'answered', admin_read_at = ? WHERE id = ? AND event_id = ?`,
        args: [now, now, id, writer.eventId],
      },
    ]);
    return { userId: inq.user_id, subject: inq.subject };
  },

  /** 「完了にする」。問い合わせた人がまた書き込むと open に戻る（addUserMessage） */
  async closeForEvent(writer: Writer, id: string): Promise<boolean> {
    return (
      (await eventRun(
        { ...writer, permission: "staff" },
        "UPDATE inquiry SET status = 'closed' WHERE id = ? AND event_id = ?",
        id,
        writer.eventId,
      )) > 0
    );
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
      event: toEvent(inq),
    };
  },
};
