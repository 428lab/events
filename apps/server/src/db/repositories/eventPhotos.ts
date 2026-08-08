import type {
  EventPhoto,
  EventTimelinePhotos,
  UserPhoto,
} from "@eventer/shared";
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
// 運営が非表示にしたコメント (#278) も同じ理由で数から外す。
// **数を出すところは必ずこの定数を使うこと**（別に書くと条件がずれる）
// 並び順に使うとき用の素の式。別名 comment_count はウィンドウ関数の ORDER BY
// からは参照できないので、式そのものが要る場所はこちらを使う
const COMMENT_COUNT_EXPR =
  `(SELECT COUNT(1) FROM event_photo_comment c
      JOIN user cu ON cu.id = c.user_id AND cu.deleted_at IS NULL
     WHERE c.photo_id = p.id AND c.admin_hidden_at IS NULL)`;
const COMMENT_COUNT = `${COMMENT_COUNT_EXPR} AS comment_count`;
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

  /** 削除の可否を決めるための素性。運営が非表示にした写真 (#278) も引ける。
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
      "SELECT id, event_id, user_id, admin_hidden_at FROM event_photo WHERE id = ?",
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
      // コメント数は一覧と同じ COMMENT_COUNT を使う。ここだけ別に書いていたため
      // 退会申請中 (#250) の投稿者ぶんが数から落ちておらず、「3件」と出て
      // 2件しか並ばないズレがあった（どちらも p が event_photo なのでそのまま使える）
      `SELECT p.id, p.event_id, e.title AS event_title, p.created_at,
              ${COMMENT_COUNT}
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

  /** 年表用: 本人が公開設定イベントに投稿した写真を、イベントごとに
   * コメントの多い順で上位 perEvent 枚だけ返す (#315)。
   *
   * 公開範囲は listPublicByUser とまったく同じ条件（photos_public=1 の公開イベント・
   * 本人の投稿・運営非表示を除く）。イベントフォトは本来「閲覧も参加者のみ」なので、
   * この条件を緩めてはいけない。
   *
   * イベントごとに1本ずつ引くと N+1 になるため、ウィンドウ関数で
   * イベント内順位と総数を1本のクエリで出している */
  async listPublicTopByUserPerEvent(
    userId: string,
    perEvent: number,
  ): Promise<EventTimelinePhotos[]> {
    const rows = await many<{
      id: string;
      event_id: string;
      comment_count: number;
      total: number;
    }>(
      `SELECT id, event_id, comment_count, total FROM (
         SELECT p.id, p.event_id, p.created_at, ${COMMENT_COUNT},
                ROW_NUMBER() OVER (
                  PARTITION BY p.event_id
                  ORDER BY ${COMMENT_COUNT_EXPR} DESC, p.created_at DESC, p.id
                ) AS rn,
                COUNT(*) OVER (PARTITION BY p.event_id) AS total
           FROM event_photo p
           JOIN event e ON e.id = p.event_id
          WHERE p.user_id = ? AND e.photos_public = 1 AND e.status = 'published'
            AND p.admin_hidden_at IS NULL
       )
       WHERE rn <= ?
       ORDER BY event_id, rn`,
      userId,
      perEvent,
    );
    const byEvent = new Map<string, EventTimelinePhotos>();
    for (const r of rows) {
      let group = byEvent.get(r.event_id);
      if (!group) {
        group = { eventId: r.event_id, photos: [], total: r.total };
        byEvent.set(r.event_id, group);
      }
      group.photos.push({ id: r.id, commentCount: r.comment_count ?? 0 });
    }
    return [...byEvent.values()];
  },
};
