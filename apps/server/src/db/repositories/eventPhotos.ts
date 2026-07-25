import type { EventPhoto } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  event_id: string;
  user_id: string;
  created_at: number;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
}

function toPhoto(row: Row): EventPhoto {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    userName: row.global_name ?? row.username,
    userAvatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT p.id, p.event_id, p.user_id, p.created_at,
  u.username, u.global_name, u.avatar_url
  FROM event_photo p JOIN user u ON u.id = p.user_id`;

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
};
