import type {
  EventPhoto,
  EventTimelinePhotos,
  UserPhoto,
  UserPhotoFacets,
} from "@eventer/shared";
import { many, one, run } from "../client.js";

interface Row {
  id: string;
  event_id: string;
  user_id: string;
  created_at: number;
  kind: string;
  duration_ms: number | null;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  comment_count: number;
}

/** DB の kind 列 → API の型。既存行は DEFAULT 'photo' なので null は来ないが、
 * 想定外の値でも video 扱いにはしない（動画配信ルートに乗せない側へ倒す） */
function toKind(kind: string | null): "photo" | "video" {
  return kind === "video" ? "video" : "photo";
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
    kind: toKind(row.kind),
    durationMs: row.duration_ms,
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
const SELECT = `SELECT p.id, p.event_id, p.user_id, p.created_at, p.kind, p.duration_ms,
  u.username, u.global_name, u.avatar_url, ${COMMENT_COUNT}
  FROM event_photo p JOIN user u ON u.id = p.user_id
    AND u.deleted_at IS NULL
  WHERE p.admin_hidden_at IS NULL`;

// 公開プロフィールに出してよい写真の条件（p=event_photo, e=event を JOIN 済み前提）。
// 本人の投稿・写真公開設定のイベント・公開済みイベント・運営非表示でない、の4つ。
// **公開プロフィール向けの経路は必ずこの断片を使うこと**（別に書くと条件がずれて、
// 下書き・非公開イベントの写真が漏れる）。フィルタは buildUserPhotoWhere が
// この断片に AND で足すだけなので、どのパラメータでも公開範囲は緩まない (#407)
const PUBLIC_USER_PHOTO_COND = `p.user_id = ? AND e.photos_public = 1
  AND e.status = 'published' AND p.admin_hidden_at IS NULL`;

/** メディアタブのフィルタ (#407)。すべて公開範囲の条件に AND される */
export interface UserPhotoFilter {
  eventId?: string;
  communityId?: string;
  /** コメントありのみ */
  commented?: boolean;
  /** 写真の投稿日時 (created_at) に対する期間。ms */
  from?: number;
  to?: number;
}

function buildUserPhotoWhere(
  userId: string,
  f: UserPhotoFilter,
): { where: string; args: (string | number)[] } {
  const conds = [PUBLIC_USER_PHOTO_COND];
  const args: (string | number)[] = [userId];
  if (f.eventId) {
    conds.push("p.event_id = ?");
    args.push(f.eventId);
  }
  if (f.communityId) {
    conds.push("e.community_id = ?");
    args.push(f.communityId);
  }
  if (f.commented) {
    conds.push(`${COMMENT_COUNT_EXPR} > 0`);
  }
  if (f.from != null) {
    conds.push("p.created_at >= ?");
    args.push(f.from);
  }
  if (f.to != null) {
    conds.push("p.created_at <= ?");
    args.push(f.to);
  }
  return { where: conds.join(" AND "), args };
}

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
    kind: "photo" | "video";
  } | null> {
    const row = await one<{
      id: string;
      event_id: string;
      user_id: string;
      admin_hidden_at: number | null;
      kind: string;
    }>(
      "SELECT id, event_id, user_id, admin_hidden_at, kind FROM event_photo WHERE id = ?",
      id,
    );
    return row
      ? {
          id: row.id,
          eventId: row.event_id,
          userId: row.user_id,
          adminHidden: row.admin_hidden_at !== null,
          kind: toKind(row.kind),
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

  /** 動画の行を作る (#408)。写真と違い R2 put が先・D1 insert が後
   * （大きいオブジェクトほど put 失敗の確率が高く、「行はあるのに実体がない」
   * 壊れ方を避けたい）ので、R2 キーに使った id を呼び出し側から受け取る */
  async createVideo(
    id: string,
    eventId: string,
    userId: string,
    meta: { durationMs: number; bytes: number; mime: string },
  ): Promise<void> {
    await run(
      `INSERT INTO event_photo (id, event_id, user_id, created_at, kind, duration_ms, bytes, mime)
       VALUES (?, ?, ?, ?, 'video', ?, ?, ?)`,
      id,
      eventId,
      userId,
      Date.now(),
      meta.durationMs,
      meta.bytes,
      meta.mime,
    );
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM event_photo WHERE id = ?", id);
  },

  /** 退会時のR2掃除用: 本人が投稿した写真・動画の (id, eventId, kind) 一覧 (#244)。
   * ここは表示ではなく実体の掃除なので、運営が非表示にした写真 (#278) も必ず含める
   * （除外すると R2 にファイルだけが残る）。
   * kind は R2 キーの組み立てに使う（video は本体＋poster の2キー #408） */
  async listIdsByUser(
    userId: string,
  ): Promise<Array<{ id: string; eventId: string; kind: "photo" | "video" }>> {
    const rows = await many<{ id: string; event_id: string; kind: string }>(
      "SELECT id, event_id, kind FROM event_photo WHERE user_id = ?",
      userId,
    );
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      kind: toKind(r.kind),
    }));
  },

  /** 公開プロフィール用: ユーザーが公開設定イベントに投稿した写真（ページング #407）。
   * 公開範囲は PUBLIC_USER_PHOTO_COND、フィルタは buildUserPhotoWhere 参照。
   * コメント数は一覧と同じ COMMENT_COUNT を使う。ここだけ別に書いていたため
   * 退会申請中 (#250) の投稿者ぶんが数から落ちておらず、「3件」と出て
   * 2件しか並ばないズレがあった（どちらも p が event_photo なのでそのまま使える） */
  async listPublicByUserPaged(
    userId: string,
    filter: UserPhotoFilter,
    limit: number,
    offset: number,
  ): Promise<UserPhoto[]> {
    const { where, args } = buildUserPhotoWhere(userId, filter);
    const rows = await many<{
      id: string;
      event_id: string;
      event_title: string;
      created_at: number;
      kind: string;
      duration_ms: number | null;
      comment_count: number;
    }>(
      `SELECT p.id, p.event_id, e.title AS event_title, p.created_at,
              p.kind, p.duration_ms, ${COMMENT_COUNT}
       FROM event_photo p
       JOIN event e ON e.id = p.event_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      ...args,
      limit,
      offset,
    );
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      eventTitle: r.event_title,
      commentCount: r.comment_count ?? 0,
      createdAt: r.created_at,
      kind: toKind(r.kind),
      durationMs: r.duration_ms,
    }));
  },

  /** listPublicByUserPaged と同じ WHERE の件数（ページング契約の total 用） */
  async countPublicByUser(
    userId: string,
    filter: UserPhotoFilter,
  ): Promise<number> {
    const { where, args } = buildUserPhotoWhere(userId, filter);
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n
         FROM event_photo p
         JOIN event e ON e.id = p.event_id
        WHERE ${where}`,
      ...args,
    );
    return row?.n ?? 0;
  },

  /** メディアタブのフィルタ選択肢 (#407)。**フィルタ適用前**の母集団
   * （= 公開範囲の条件だけ）から出す。絞った結果で選択肢が痩せないため。
   * 公開範囲の条件を共有しているので、下書き・非公開イベントの名前が
   * 選択肢に漏れることもない */
  async photoFacetsForUser(userId: string): Promise<UserPhotoFacets> {
    const events = await many<{ id: string; title: string; n: number }>(
      `SELECT e.id, e.title, COUNT(1) AS n
         FROM event_photo p
         JOIN event e ON e.id = p.event_id
        WHERE ${PUBLIC_USER_PHOTO_COND}
        GROUP BY e.id
        ORDER BY n DESC, e.title`,
      userId,
    );
    const communities = await many<{ id: string; name: string; n: number }>(
      `SELECT c.id, c.name, COUNT(1) AS n
         FROM event_photo p
         JOIN event e ON e.id = p.event_id
         JOIN community c ON c.id = e.community_id
        WHERE ${PUBLIC_USER_PHOTO_COND}
        GROUP BY c.id
        ORDER BY n DESC, c.name`,
      userId,
    );
    return {
      events: events.map((r) => ({ id: r.id, title: r.title, count: r.n })),
      communities: communities.map((r) => ({
        id: r.id,
        name: r.name,
        count: r.n,
      })),
    };
  },

  /** 年表用: 本人が公開設定イベントに投稿した写真を、イベントごとに
   * コメントの多い順で上位 perEvent 枚だけ返す (#315)。
   *
   * 公開範囲は PUBLIC_USER_PHOTO_COND（photos_public=1 の公開イベント・
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
      kind: string;
      duration_ms: number | null;
      comment_count: number;
      total: number;
    }>(
      `SELECT id, event_id, kind, duration_ms, comment_count, total FROM (
         SELECT p.id, p.event_id, p.created_at, p.kind, p.duration_ms, ${COMMENT_COUNT},
                ROW_NUMBER() OVER (
                  PARTITION BY p.event_id
                  ORDER BY ${COMMENT_COUNT_EXPR} DESC, p.created_at DESC, p.id
                ) AS rn,
                COUNT(*) OVER (PARTITION BY p.event_id) AS total
           FROM event_photo p
           JOIN event e ON e.id = p.event_id
          WHERE ${PUBLIC_USER_PHOTO_COND}
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
      group.photos.push({
        id: r.id,
        commentCount: r.comment_count ?? 0,
        kind: toKind(r.kind),
        durationMs: r.duration_ms,
      });
    }
    return [...byEvent.values()];
  },
};
