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

// 運営が非表示にしたコメント (#278) は **この SELECT を通る全経路** から落とす。
// WHERE をここに含めておくことで、呼び出し側は AND で足すだけになり、
// 経路が増えたときに除外を書き忘れられないようにしている
const SELECT = `SELECT c.id, c.event_id, c.user_id, c.body, c.created_at,
  u.username, u.global_name, u.avatar_url
  FROM event_comment c JOIN user u ON u.id = c.user_id
    AND u.deleted_at IS NULL
  WHERE c.admin_hidden_at IS NULL`;

export const eventCommentsRepo = {
  async listByEvent(eventId: string): Promise<EventComment[]> {
    const rows = await many<Row>(
      `${SELECT} AND c.event_id = ? ORDER BY c.created_at ASC`,
      eventId,
    );
    return rows.map(toComment);
  },

  async findById(id: string): Promise<EventComment | null> {
    const row = await one<Row>(`${SELECT} AND c.id = ?`, id);
    return row ? toComment(row) : null;
  },

  /** 削除の可否を決めるための素性。運営が非表示にしたコメント (#278) も引ける。
   * findById は非表示を落とすので、それで判定すると投稿者本人にもスタッフにも
   * 404 になり、なぜ消せないのかが伝わらない（Q&A の meta と同じ役回り） */
  async meta(id: string): Promise<{
    id: string;
    eventId: string;
    userId: string;
    adminHidden: boolean;
  } | null> {
    const row = await one<{
      id: string;
      event_id: string;
      user_id: string;
      admin_hidden_at: number | null;
    }>(
      "SELECT id, event_id, user_id, admin_hidden_at FROM event_comment WHERE id = ?",
      id,
    );
    return row
      ? {
          id: row.id,
          eventId: row.event_id,
          userId: row.user_id,
          adminHidden: row.admin_hidden_at !== null,
        }
      : null;
  },

  /** 上限チェック用。非表示のものも数に入れる（eventPhotos.countByEvent と同じ） */
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
