import type { PhotoComment } from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  photo_id: string;
  user_id: string;
  body: string;
  created_at: number;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
}

function toComment(row: Row): PhotoComment {
  return {
    id: row.id,
    photoId: row.photo_id,
    userId: row.user_id,
    userName: row.global_name ?? row.username,
    userAvatarUrl: row.avatar_url,
    username: row.username,
    body: row.body,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT c.id, c.photo_id, c.user_id, c.body, c.created_at,
  u.username, u.global_name, u.avatar_url
  FROM event_photo_comment c JOIN user u ON u.id = c.user_id`;

export const eventPhotoCommentsRepo = {
  async listByPhoto(photoId: string): Promise<PhotoComment[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE c.photo_id = ? ORDER BY c.created_at ASC`,
      photoId,
    );
    return rows.map(toComment);
  },

  async findById(id: string): Promise<PhotoComment | null> {
    const row = await one<Row>(`${SELECT} WHERE c.id = ?`, id);
    return row ? toComment(row) : null;
  },

  async countByPhoto(photoId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_photo_comment WHERE photo_id = ?",
      photoId,
    );
    return row?.n ?? 0;
  },

  async create(
    photoId: string,
    userId: string,
    body: string,
  ): Promise<PhotoComment> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_photo_comment (id, photo_id, user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      photoId,
      userId,
      body,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM event_photo_comment WHERE id = ?", id);
  },
};
