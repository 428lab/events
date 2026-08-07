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

// コメント数も投稿者が退会申請中 (#250) の分は除く。一覧（eventPhotoComments の
// SELECT）が同じ条件で隠すので、揃えないと「3件」と出て2件しか表示されない。
// 運営が非表示にしたコメント (#278) も同じ理由で数から外す
const COMMENT_COUNT =
  `(SELECT COUNT(1) FROM event_photo_comment c
      JOIN user cu ON cu.id = c.user_id AND cu.deleted_at IS NULL
     WHERE c.photo_id = p.id AND c.admin_hidden_at IS NULL) AS comment_count`;
// 運営が非表示にした写真 (#278) は **この SELECT を通る全経路** から落とす。
// WHERE をここに含めておくことで、呼び出し側は AND で足すだけになり、
// 経路が増えたときに除外を書き忘れられないようにしている
// （非表示のものを見られるのは管理画面の adminModeration 専用クエリだけ）
const SELECT = `SELECT p.id, p.event_id, p.user_id, p.created_at,
  u.username, u.global_name, u.avatar_url, ${COMMENT_COUNT}
  FROM event_photo p JOIN user u ON u.id = p.user_id
    AND u.deleted_at IS NULL
  WHERE p.admin_hidden_at IS NULL`;

export const eventPhotosRepo = {
  async listByEvent(eventId: string): Promise<EventPhoto[]> {
    const rows = await many<Row>(
      `${SELECT} AND p.event_id = ? ORDER BY p.created_at DESC`,
      eventId,
    );
    return rows.map(toPhoto);
  },

  async findById(id: string): Promise<EventPhoto | null> {
    const row = await one<Row>(`${SELECT} AND p.id = ?`, id);
    return row ? toPhoto(row) : null;
  },

  /** イベントの枚数（上限チェック用）。運営が非表示にした写真 (#278) も数に入れる。
   * 行は残っているので、非表示にされるたびに上限が空くのはおかしい（Q&A と同じ扱い） */
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

  /** 退会時のR2掃除用: 本人が投稿した写真の (id, eventId) 一覧 (#244)。
   * ここは表示ではなく実体の掃除なので、運営が非表示にした写真 (#278) も必ず含める
   * （除外すると R2 にファイルだけが残る） */
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
              (SELECT COUNT(1) FROM event_photo_comment c
                WHERE c.photo_id = p.id AND c.admin_hidden_at IS NULL)
                AS comment_count
       FROM event_photo p
       JOIN event e ON e.id = p.event_id
       WHERE p.user_id = ? AND e.photos_public = 1 AND e.status = 'published'
         AND p.admin_hidden_at IS NULL
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
