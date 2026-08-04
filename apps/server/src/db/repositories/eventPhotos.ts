import type { EventPhoto, UserPhoto } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  event_id: string;
  user_id: string;
  created_at: number;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  comment_count: number;
}

function toPhoto(row: Row): EventPhoto {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    userName: row.global_name ?? row.username,
    userAvatarUrl: row.avatar_url,
    commentCount: row.comment_count ?? 0,
    createdAt: row.created_at,
  };
}

const COMMENT_COUNT =
  "(SELECT COUNT(1) FROM event_photo_comment c WHERE c.photo_id = p.id) AS comment_count";
const SELECT = `SELECT p.id, p.event_id, p.user_id, p.created_at,
  u.username, u.global_name, u.avatar_url, ${COMMENT_COUNT}
  FROM event_photo p JOIN user u ON u.id = p.user_id
    AND u.deleted_at IS NULL`;

export const eventPhotosRepo = {
  async listByEvent(eventId: string): Promise<EventPhoto[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE p.event_id = ? ORDER BY p.created_at DESC`,
      eventId,
    );
    return rows.map(toPhoto);
  },

  async findById(id: string): Promise<EventPhoto | null> {
    const row = await one<Row>(`${SELECT} WHERE p.id = ?`, id);
    return row ? toPhoto(row) : null;
  },

  async countByEvent(eventId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_photo WHERE event_id = ?",
      eventId,
    );
    return row?.n ?? 0;
  },

  async create(eventId: string, userId: string): Promise<string> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_photo (id, event_id, user_id, created_at)
       VALUES (?, ?, ?, ?)`,
      id,
      eventId,
      userId,
      Date.now(),
    );
    return id;
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM event_photo WHERE id = ?", id);
  },

  /** 退会時のR2掃除用: 本人が投稿した写真の (id, eventId) 一覧 (#244) */
  async listIdsByUser(
    userId: string,
  ): Promise<Array<{ id: string; eventId: string }>> {
    const rows = await many<{ id: string; event_id: string }>(
      "SELECT id, event_id FROM event_photo WHERE user_id = ?",
      userId,
    );
    return rows.map((r) => ({ id: r.id, eventId: r.event_id }));
  },

  /** 公開プロフィール用: ユーザーが公開設定イベントに投稿した写真 */
  async listPublicByUser(userId: string): Promise<UserPhoto[]> {
    const rows = await many<{
      id: string;
      event_id: string;
      event_title: string;
      created_at: number;
      comment_count: number;
    }>(
      `SELECT p.id, p.event_id, e.title AS event_title, p.created_at,
              (SELECT COUNT(1) FROM event_photo_comment c WHERE c.photo_id = p.id)
                AS comment_count
       FROM event_photo p
       JOIN event e ON e.id = p.event_id
       WHERE p.user_id = ? AND e.photos_public = 1 AND e.status = 'published'
       ORDER BY p.created_at DESC`,
      userId,
    );
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      eventTitle: r.event_title,
      commentCount: r.comment_count ?? 0,
      createdAt: r.created_at,
    }));
  },
};
