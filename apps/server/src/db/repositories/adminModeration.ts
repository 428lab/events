import { MODERATION_EVENT_LIMIT, MODERATION_LOOKBACK_MS } from "@eventer/shared";
import type { ModerationEvent, ModerationItem } from "@eventer/shared";
import { many, one, runCount } from "../client.js";

/** 運営によるイベント内コンテンツの非表示 (#278) のデータ層。
 *
 * ここは **管理画面専用**で、通常の一覧が落としているもの（運営が非表示にしたもの、
 * 投稿者が退会申請中 (#250) のもの）も含めて全部返す。対処するには中身が見えないと
 * 判断できないため。逆に、通常の読み出し経路が非表示を落とすのは各リポジトリの
 * SELECT 側の責任（eventPhotos / eventPhotoComments / eventComments / eventQa）。
 *
 * 投稿者は LEFT JOIN で引く。退会申請中でも表示するのと、将来 user 行が
 * 消えるケースが増えても一覧が空にならないようにするため。 */

/** 対処できるテーブルと、その行がどのイベントに属するかの引き方。
 * kind → SQL の対応をこの1箇所に閉じ込め、hide/restore で分岐を書かないようにする */
const TARGETS = {
  photo: {
    table: "event_photo",
    /** id と event_id で行を特定する（他イベントのIDを差し込まれても効かない） */
    where: "id = ? AND event_id = ?",
  },
  photo_comment: {
    table: "event_photo_comment",
    // 写真コメントは event_id を持たないので、写真を経由してイベントを確かめる
    where:
      "id = ? AND photo_id IN (SELECT id FROM event_photo WHERE event_id = ?)",
  },
  event_comment: { table: "event_comment", where: "id = ? AND event_id = ?" },
  question: { table: "event_question", where: "id = ? AND event_id = ?" },
} as const;

/** hide/restore できる kind（チャットは本文がサーバーに無く、別テーブルなので除く） */
export type RowKind = keyof typeof TARGETS;

interface EventRow {
  id: string;
  title: string;
  status: string;
  starts_at: number;
  ends_at: number;
  host_handle: string | null;
}

function toEvent(r: EventRow): ModerationEvent {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    hostHandle: r.host_handle ?? "",
  };
}

const EVENT_SELECT = `SELECT e.id, e.title, e.status, e.starts_at, e.ends_at,
    u.username AS host_handle
  FROM event e LEFT JOIN user u ON u.id = e.created_by`;

interface ItemRow {
  id: string;
  photo_id: string | null;
  body: string | null;
  user_id: string | null;
  username: string | null;
  global_name: string | null;
  created_at: number;
  admin_hidden_at: number | null;
  admin_hidden_by: string | null;
  staff_hidden: number;
}

function toItem(kind: ModerationItem["kind"], r: ItemRow): ModerationItem {
  return {
    kind,
    id: r.id,
    photoId: r.photo_id,
    body: r.body,
    authorUserId: r.user_id,
    authorHandle: r.username ?? "",
    authorName: r.global_name ?? r.username ?? "",
    createdAt: r.created_at,
    hiddenAt: r.admin_hidden_at,
    hiddenBy: r.admin_hidden_by,
    staffHidden: r.staff_hidden === 1,
  };
}

export const adminModerationRepo = {
  async findEvent(eventId: string): Promise<ModerationEvent | null> {
    const row = await one<EventRow>(`${EVENT_SELECT} WHERE e.id = ?`, eventId);
    return row ? toEvent(row) : null;
  },

  /**
   * 対処するイベントを探す。
   *
   * - `userId`: そのユーザーが **主催した** イベントと、**投稿した** イベント。
   *   要確認リスト (#259) はユーザー単位なので、そこから対象イベントに辿る導線になる。
   * - `q`: イベントIDそのもの、またはタイトルの部分一致。
   *
   * 投稿側は MODERATION_LOOKBACK_MS 以内に絞ってある。D1 は rows_read 課金で、
   * event_comment のような大きいテーブルを user_id で全走査すると跳ねるため
   * （event_comment には created_at のインデックスがある）。運営が管理画面で
   * ときどき叩くだけの経路なので、範囲を切るほうを優先している。
   */
  async searchEvents({
    userId,
    q,
  }: {
    userId?: string;
    q?: string;
  }): Promise<{ events: ModerationEvent[]; truncated: boolean }> {
    // +1 件多く引いて「打ち切ったか」を判定する
    const limit = MODERATION_EVENT_LIMIT + 1;
    let rows: EventRow[];
    if (userId) {
      const since = Date.now() - MODERATION_LOOKBACK_MS;
      rows = await many<EventRow>(
        `${EVENT_SELECT}
          WHERE e.id IN (
            SELECT id FROM event WHERE created_by = ?
            UNION SELECT event_id FROM event_comment WHERE user_id = ? AND created_at >= ?
            UNION SELECT event_id FROM event_photo WHERE user_id = ? AND created_at >= ?
            UNION SELECT p.event_id FROM event_photo_comment c
                    JOIN event_photo p ON p.id = c.photo_id
                   WHERE c.user_id = ? AND c.created_at >= ?
            UNION SELECT event_id FROM event_question WHERE user_id = ? AND created_at >= ?
          )
          ORDER BY e.starts_at DESC LIMIT ?`,
        userId,
        userId,
        since,
        userId,
        since,
        userId,
        since,
        userId,
        since,
        limit,
      );
    } else {
      const term = (q ?? "").trim();
      if (!term) return { events: [], truncated: false };
      // LIKE の特殊文字はエスケープする（% だけの入力で全件引かせない）
      const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      rows = await many<EventRow>(
        `${EVENT_SELECT}
          WHERE e.id = ? OR e.title LIKE ? ESCAPE '\\'
          ORDER BY e.starts_at DESC LIMIT ?`,
        term,
        `%${escaped}%`,
        limit,
      );
    }
    return {
      events: rows.slice(0, MODERATION_EVENT_LIMIT).map(toEvent),
      truncated: rows.length > MODERATION_EVENT_LIMIT,
    };
  },

  /** イベント内のコンテンツを全部（非表示のものも）返す。
   * 1イベントぶんなので上限は各コンテンツの投稿上限（写真50・コメント等）で頭打ちになる */
  async listContent(eventId: string): Promise<ModerationItem[]> {
    const [photos, photoComments, comments, questions] = await Promise.all([
      many<ItemRow>(
        `SELECT p.id, NULL AS photo_id, NULL AS body, p.user_id,
                u.username, u.global_name, p.created_at,
                p.admin_hidden_at, p.admin_hidden_by, 0 AS staff_hidden
           FROM event_photo p LEFT JOIN user u ON u.id = p.user_id
          WHERE p.event_id = ? ORDER BY p.created_at DESC`,
        eventId,
      ),
      many<ItemRow>(
        `SELECT c.id, c.photo_id, c.body, c.user_id,
                u.username, u.global_name, c.created_at,
                c.admin_hidden_at, c.admin_hidden_by, 0 AS staff_hidden
           FROM event_photo_comment c
           JOIN event_photo p ON p.id = c.photo_id
           LEFT JOIN user u ON u.id = c.user_id
          WHERE p.event_id = ? ORDER BY c.created_at DESC`,
        eventId,
      ),
      many<ItemRow>(
        `SELECT c.id, NULL AS photo_id, c.body, c.user_id,
                u.username, u.global_name, c.created_at,
                c.admin_hidden_at, c.admin_hidden_by, 0 AS staff_hidden
           FROM event_comment c LEFT JOIN user u ON u.id = c.user_id
          WHERE c.event_id = ? ORDER BY c.created_at DESC`,
        eventId,
      ),
      many<ItemRow>(
        `SELECT q.id, NULL AS photo_id, q.body, q.user_id,
                u.username, u.global_name, q.created_at,
                q.admin_hidden_at, q.admin_hidden_by,
                CASE WHEN q.hidden = 1 AND q.admin_hidden_at IS NULL THEN 1 ELSE 0 END
                  AS staff_hidden
           FROM event_question q LEFT JOIN user u ON u.id = q.user_id
          WHERE q.event_id = ? ORDER BY q.created_at DESC`,
        eventId,
      ),
    ]);
    return [
      ...photos.map((r) => toItem("photo", r)),
      ...photoComments.map((r) => toItem("photo_comment", r)),
      ...comments.map((r) => toItem("event_comment", r)),
      ...questions.map((r) => toItem("question", r)),
    ];
  },

  /** 非表示にする。既に非表示なら 0 を返す（画面の再読込で揃う）。
   *
   * Q&A はスタッフ用の hidden も一緒に立てる。**既にある非表示の仕組みに載せる**
   * ことで、Q&A の読み出し経路（投影画面・ピックアップ）に手を入れずに済む */
  async hide(
    kind: RowKind,
    id: string,
    eventId: string,
    adminId: string,
    at: number,
  ): Promise<number> {
    const t = TARGETS[kind];
    const extra = kind === "question" ? ", hidden = 1" : "";
    return runCount(
      `UPDATE ${t.table}
          SET admin_hidden_at = ?, admin_hidden_by = ?${extra}
        WHERE ${t.where} AND admin_hidden_at IS NULL`,
      at,
      adminId,
      id,
      eventId,
    );
  },

  /** 復元する。Q&A はスタッフ用の hidden も一緒に下ろす
   * （運営が対処する前にスタッフが非表示にしていたかは記録していないので、
   * 「対処を取り消す＝見えるところまで戻す」に倒す） */
  async restore(kind: RowKind, id: string, eventId: string): Promise<number> {
    const t = TARGETS[kind];
    const extra = kind === "question" ? ", hidden = 0" : "";
    return runCount(
      `UPDATE ${t.table}
          SET admin_hidden_at = NULL, admin_hidden_by = NULL${extra}
        WHERE ${t.where} AND admin_hidden_at IS NOT NULL`,
      id,
      eventId,
    );
  },

  /** 監査ログの当事者に入れる投稿者。実行時点のハンドルも一緒に返す (#248 の方針)。
   * 対象がそのイベントの行でなければ null（hide/restore と同じ条件で引く） */
  async findRowAuthor(
    kind: RowKind,
    id: string,
    eventId: string,
  ): Promise<{ id: string; handle: string } | null> {
    const t = TARGETS[kind];
    // ハンドルは相関サブクエリで引く。JOIN にすると where のカラム名に
    // テーブル別名が要るようになり、hide/restore と同じ条件を使い回せなくなる
    const row = await one<{ user_id: string; username: string | null }>(
      `SELECT user_id, (SELECT username FROM user WHERE id = user_id) AS username
         FROM ${t.table} WHERE ${t.where}`,
      id,
      eventId,
    );
    return row ? { id: row.user_id, handle: row.username ?? "" } : null;
  },

  /** 管理画面の画像表示用。非表示の写真も引ける（対処を判断するには中身が要る） */
  async findPhotoForAdmin(
    eventId: string,
    photoId: string,
  ): Promise<{ id: string; eventId: string } | null> {
    const row = await one<{ id: string; event_id: string }>(
      "SELECT id, event_id FROM event_photo WHERE id = ? AND event_id = ?",
      photoId,
      eventId,
    );
    return row ? { id: row.id, eventId: row.event_id } : null;
  },
};
