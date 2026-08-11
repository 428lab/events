import type {
  MyStaffInvite,
  StaffInvite,
  StaffInviteStatus,
  User,
} from "@eventer/shared";
import { batch, many, one, run, runCount } from "../client.js";

/** 運営スタッフへの招待 (#339)。
 *
 * event_member とは別の表にしている。承諾前の人をメンバー表に入れると
 * 「メンバーだから公開前イベントが見える」判定（routes/events.ts の canView）を
 * 通ってしまうため。ここに居るだけでは何の権限も生まれない。 */

interface InviteRow {
  id: string;
  event_id: string;
  user_id: string;
  invited_by: string;
  status: string;
  created_at: number;
  responded_at: number | null;
}

/** 招待の1行に、招待された人・招待した人・イベントを結合した形 */
interface InviteJoinedRow extends InviteRow {
  iu_id: string;
  iu_discord_id: string;
  iu_username: string;
  iu_global_name: string | null;
  iu_avatar_url: string | null;
  iu_created_at: number;
  bu_id: string;
  bu_discord_id: string;
  bu_username: string;
  bu_global_name: string | null;
  bu_avatar_url: string | null;
  bu_created_at: number;
}

interface MyInviteRow extends InviteJoinedRow {
  e_title: string;
  e_starts_at: number;
  e_ends_at: number;
  e_status: string;
  /** 自分がそのイベントで参加枠を押さえているか（0/1） */
  m_holds_slot: number;
}

function toInvite(row: InviteRow): {
  id: string;
  eventId: string;
  userId: string;
  invitedBy: string;
  status: StaffInviteStatus;
  createdAt: number;
  respondedAt: number | null;
} {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    invitedBy: row.invited_by,
    status: row.status as StaffInviteStatus,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}
export type StaffInviteRecord = ReturnType<typeof toInvite>;

function user(prefix: "iu" | "bu", row: InviteJoinedRow): User {
  const pick = <T>(key: string): T => (row as unknown as Record<string, T>)[`${prefix}_${key}`]!;
  return {
    id: pick<string>("id"),
    discordId: pick<string>("discord_id"),
    username: pick<string>("username"),
    globalName: pick<string | null>("global_name"),
    avatarUrl: pick<string | null>("avatar_url"),
    createdAt: pick<number>("created_at"),
  };
}

/** user 表の列を prefix 付きで並べる（招待された人 iu と招待した人 bu の2人ぶんを
 * 1行で取るため）。toUser 相当の読み出しは上の user() に対応させること */
function userCols(prefix: "iu" | "bu"): string {
  return ["id", "discord_id", "username", "global_name", "avatar_url", "created_at"]
    .map((col) => `${prefix}.${col} AS ${prefix}_${col}`)
    .join(", ");
}

/** 招待された人と招待した人の JOIN。どちらも退会申請中 (#250) なら行ごと落とす
 * （相手が消えた招待は一覧に出さない） */
const USER_JOINS = `
    JOIN user iu ON iu.id = i.user_id AND iu.deleted_at IS NULL
    JOIN user bu ON bu.id = i.invited_by AND bu.deleted_at IS NULL`;

export const eventStaffInvitesRepo = {
  async find(
    eventId: string,
    userId: string,
  ): Promise<StaffInviteRecord | null> {
    const row = await one<InviteRow>(
      "SELECT * FROM event_staff_invite WHERE event_id = ? AND user_id = ?",
      eventId,
      userId,
    );
    return row ? toInvite(row) : null;
  },

  async findById(id: string): Promise<StaffInviteRecord | null> {
    const row = await one<InviteRow>(
      "SELECT * FROM event_staff_invite WHERE id = ?",
      id,
    );
    return row ? toInvite(row) : null;
  },

  /** 招待する（辞退・取り消し済みの相手を招き直す場合は同じ行を pending に戻す）。
   * 1イベント1ユーザー1行なので「いま有効な招待」は常に一意に決まる */
  async invite(
    eventId: string,
    userId: string,
    invitedBy: string,
  ): Promise<StaffInviteRecord> {
    const now = Date.now();
    await run(
      `INSERT INTO event_staff_invite
         (id, event_id, user_id, invited_by, status, created_at, responded_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NULL)
       ON CONFLICT(event_id, user_id) DO UPDATE SET
         invited_by = excluded.invited_by,
         status = 'pending',
         created_at = excluded.created_at,
         responded_at = NULL`,
      crypto.randomUUID(),
      eventId,
      userId,
      invitedBy,
      now,
    );
    return (await this.find(eventId, userId))!;
  },

  /**
   * 返事待ちの招待だけを次の状態へ進める。
   *
   * 条件に status='pending' を含めた1文の UPDATE にしてあるのは、承諾と取り消しが
   * ぶつかったときにどちらか一方だけを成立させるため（読んでから書くと、取り消し
   * 済みの招待でも承諾が通ってしまう）。
   *
   * @returns 実際に更新できたら true
   */
  async resolveIfPending(
    id: string,
    status: Exclude<StaffInviteStatus, "pending">,
  ): Promise<boolean> {
    const changed = await runCount(
      `UPDATE event_staff_invite SET status = ?, responded_at = ?
        WHERE id = ? AND status = 'pending'`,
      status,
      Date.now(),
      id,
    );
    return changed > 0;
  },

  /**
   * 承諾を成立させる：招待を accepted にして、同時に staff のメンバー行を作る。
   *
   * **1回のバッチにまとめる**のが肝。別々に書くと、間で失敗したときに
   * 「招待だけ消費されて運営になっていない」行が残り、本人には直す手立てが無い。
   *
   * 2文目以降は「この呼び出しで承諾できた場合だけ」書くよう、1文目が立てた
   * responded_at と同じ値を条件に入れてある。単に status='accepted' を見るだけだと
   * 前回の承諾で立った値にも当たり、二重実行でメンバー行を書き直してしまう。
   *
   * メンバー行の扱いは eventMembersRepo の add / setRole に合わせる。
   * 取消済みの行は参加日時を今にして復活させ（並び順の公平のため）、出席の記録も
   * 落とす。生きている行はロールだけ staff にして枠を外し、参加確定に揃える (#277)。
   *
   * @returns 承諾が成立したら true（返事待ちでなければ false）
   */
  async accept(
    inviteId: string,
    eventId: string,
    userId: string,
  ): Promise<boolean> {
    const now = Date.now();
    // 「今回この呼び出しで承諾された招待か」。2文目以降のガード
    const acceptedNow = `EXISTS (SELECT 1 FROM event_staff_invite i
                                  WHERE i.id = ? AND i.event_id = ? AND i.user_id = ?
                                    AND i.status = 'accepted' AND i.responded_at = ?)`;
    const guard = [inviteId, eventId, userId, now];
    const [changed] = await batch([
      {
        sql: `UPDATE event_staff_invite SET status = 'accepted', responded_at = ?
               WHERE id = ? AND status = 'pending'`,
        args: [now, inviteId],
      },
      {
        sql: `INSERT INTO event_member
                (id, event_id, user_id, role, slot_id, status, created_at)
              SELECT ?, ?, ?, 'staff', NULL, 'confirmed', ?
               WHERE ${acceptedNow}
                 AND NOT EXISTS (SELECT 1 FROM event_member
                                  WHERE event_id = ? AND user_id = ?)`,
        args: [crypto.randomUUID(), eventId, userId, now, ...guard, eventId, userId],
      },
      {
        sql: `UPDATE event_member
                 SET role = 'staff', slot_id = NULL, status = 'confirmed',
                     attended = CASE WHEN status = 'canceled' THEN 0 ELSE attended END,
                     attended_at = CASE WHEN status = 'canceled' THEN NULL ELSE attended_at END,
                     canceled_at = NULL, canceled_scheduling = 0,
                     created_at = CASE WHEN status = 'canceled' THEN ? ELSE created_at END
               WHERE event_id = ? AND user_id = ? AND ${acceptedNow}`,
        args: [now, eventId, userId, ...guard],
      },
    ]);
    return (changed ?? 0) > 0;
  },

  /** 運営側の一覧から片付ける（取り消し／断られた行の始末）。
   *
   * 承諾済みは対象外。運営から外すのはロール変更の仕事で、ここで消しても
   * 権限は変わらない＝「消したのに運営のまま」という取り違えを招くため。
   *
   * @returns 実際に片付けられたら true */
  async revoke(id: string): Promise<boolean> {
    const changed = await runCount(
      `UPDATE event_staff_invite SET status = 'revoked', responded_at = ?
        WHERE id = ? AND status IN ('pending', 'declined')`,
      Date.now(),
      id,
    );
    return changed > 0;
  },

  /** イベントの招待一覧（運営向け）。取り消したものは出さない */
  async listByEvent(eventId: string): Promise<StaffInvite[]> {
    const rows = await many<InviteJoinedRow>(
      `SELECT i.*, ${userCols("iu")}, ${userCols("bu")}
         FROM event_staff_invite i${USER_JOINS}
        WHERE i.event_id = ? AND i.status <> 'revoked'
        ORDER BY i.created_at DESC`,
      eventId,
    );
    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      status: row.status as StaffInviteStatus,
      createdAt: row.created_at,
      respondedAt: row.responded_at,
      user: user("iu", row),
      invitedBy: user("bu", row),
    }));
  },

  /** 自分宛の返事待ちの招待。
   * イベントは題名と開催日時だけを返す（公開前の中身は承諾するまで見せない） */
  async listPendingForUser(userId: string): Promise<MyStaffInvite[]> {
    const rows = await many<MyInviteRow>(
      `SELECT i.*, ${userCols("iu")}, ${userCols("bu")},
              e.title AS e_title, e.starts_at AS e_starts_at,
              e.ends_at AS e_ends_at, e.status AS e_status,
              CASE WHEN m.slot_id IS NOT NULL THEN 1 ELSE 0 END AS m_holds_slot
         FROM event_staff_invite i
         JOIN event e ON e.id = i.event_id${USER_JOINS}
         LEFT JOIN event_member m
                ON m.event_id = i.event_id AND m.user_id = i.user_id
               AND m.status <> 'canceled'
        WHERE i.user_id = ? AND i.status = 'pending'
        ORDER BY i.created_at DESC`,
      userId,
    );
    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.e_title,
      eventStartsAt: row.e_starts_at,
      eventEndsAt: row.e_ends_at,
      eventPublished: row.e_status === "published",
      holdsSlot: row.m_holds_slot === 1,
      invitedBy: user("bu", row),
      createdAt: row.created_at,
    }));
  },
};
