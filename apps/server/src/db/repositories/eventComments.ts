import type { EventComment } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  event_id: string;
  user_id: string;
  body: string;
  created_at: number;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
}

function toComment(row: Row): EventComment {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    userName: row.global_name ?? row.username,
    userAvatarUrl: row.avatar_url,
    username: row.username,
    body: row.body,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT c.id, c.event_id, c.user_id, c.body, c.created_at,
  u.username, u.global_name, u.avatar_url
  FROM event_comment c JOIN user u ON u.id = c.user_id`;

export const eventCommentsRepo = {
  async listByEvent(eventId: string): Promise<EventComment[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE c.event_id = ? ORDER BY c.created_at ASC`,
      eventId,
    );
    return rows.map(toComment);
  },

  async findById(id: string): Promise<EventComment | null> {
    const row = await one<Row>(`${SELECT} WHERE c.id = ?`, id);
    return row ? toComment(row) : null;
  },

  async countByEvent(eventId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_comment WHERE event_id = ?",
      eventId,
    );
    return row?.n ?? 0;
  },

  async create(
    eventId: string,
    userId: string,
    body: string,
  ): Promise<EventComment> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_comment (id, event_id, user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      eventId,
      userId,
      body,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM event_comment WHERE id = ?", id);
  },
};
