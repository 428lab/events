import type {
  EventMember,
  EventMemberWithUser,
  EventRole,
  MyEventSummary,
  User,
} from "@eventer/shared";
import { many, one, run } from "../client.js";
import { COUNTED_MEMBER_IS_ACTIVE } from "./events.js";

interface MemberRow {
  id: string;
  event_id: string;
  user_id: string;
  role: string;
  slot_id: string | null;
  status: string;
  attended: number;
  attended_at: number | null;
  created_at: number;
}

interface MemberUserRow extends MemberRow {
  u_id: string;
  u_discord_id: string;
  u_username: string;
  u_global_name: string | null;
  u_avatar_url: string | null;
  u_created_at: number;
}

function toMember(row: MemberRow): EventMember {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    role: row.role as EventRole,
    slotId: row.slot_id,
    status: row.status,
    attended: row.attended === 1,
    attendedAt: row.attended_at,
    createdAt: row.created_at,
  };
}

function toUser(row: MemberUserRow): User {
  return {
    id: row.u_id,
    discordId: row.u_discord_id,
    username: row.u_username,
    globalName: row.u_global_name,
    avatarUrl: row.u_avatar_url,
    createdAt: row.u_created_at,
  };
}

export const eventMembersRepo = {
  /** 現役メンバーを返す（キャンセル済みはメンバー扱いしない） */
  async find(eventId: string, userId: string): Promise<EventMember | null> {
    const row = await one<MemberRow>(
      "SELECT * FROM event_member WHERE event_id = ? AND user_id = ? AND status <> 'canceled'",
      eventId,
      userId,
    );
    return row ? toMember(row) : null;
  },

  /** キャンセル済みの行も含めて返す（再参加の復活判定用） */
  async findIncludingCanceled(
    eventId: string,
    userId: string,
  ): Promise<EventMember | null> {
    const row = await one<MemberRow>(
      "SELECT * FROM event_member WHERE event_id = ? AND user_id = ?",
      eventId,
      userId,
    );
    return row ? toMember(row) : null;
  },

  async add(
    eventId: string,
    userId: string,
    role: EventRole,
    slotId: string | null = null,
    status = "confirmed",
  ): Promise<EventMember> {
    const existing = await this.findIncludingCanceled(eventId, userId);
    if (existing && existing.status !== "canceled") return existing;
    if (existing) {
      // キャンセル済みの再参加: 行を復活させる（並び順の公平のため参加日時は今）
      await run(
        `UPDATE event_member
            SET role = ?, slot_id = ?, status = ?, attended = 0, attended_at = NULL,
                canceled_at = NULL, canceled_scheduling = 0, created_at = ?
          WHERE id = ?`,
        role,
        slotId,
        status,
        Date.now(),
        existing.id,
      );
      return (await this.find(eventId, userId))!;
    }
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      eventId,
      userId,
      role,
      slotId,
      status,
      Date.now(),
    );
    return (await this.find(eventId, userId))!;
  },

  /** 抽選などで状態を更新 */
  async setStatus(memberId: string, status: string): Promise<void> {
    await run(
      "UPDATE event_member SET status = ? WHERE id = ?",
      status,
      memberId,
    );
  },

  /** 出席チェックの更新（staff）。
   * attendedAt: 出席にする時刻（通常 Date.now()）。既に出席済みなら最初の時刻を保持し、
   * 出席解除では NULL に戻す (#154) */
  async setAttended(
    eventId: string,
    userId: string,
    attended: boolean,
    attendedAt: number | null,
  ): Promise<EventMember | null> {
    await run(
      `UPDATE event_member
          SET attended = ?,
              attended_at = CASE WHEN ? = 1 THEN COALESCE(attended_at, ?) ELSE NULL END
        WHERE event_id = ? AND user_id = ? AND status <> 'canceled'`,
      attended ? 1 : 0,
      attended ? 1 : 0,
      attendedAt,
      eventId,
      userId,
    );
    return this.find(eventId, userId);
  },

  /** 枠の特定状態のメンバー（抽選・繰り上げ用）。
   * 退会申請中 (#250) は除外する。当選させても本人には通知も参加もできず、
   * 枠だけ消費してしまうため。行はそのまま残るので復帰すれば申込に戻る */
  async membersBySlotStatus(
    slotId: string,
    status: string,
  ): Promise<Array<{ id: string; userId: string }>> {
    const rows = await many<{ id: string; user_id: string }>(
      `SELECT m.id, m.user_id FROM event_member m
         JOIN user u ON u.id = m.user_id AND u.deleted_at IS NULL
        WHERE m.slot_id = ? AND m.status = ? ORDER BY m.created_at ASC`,
      slotId,
      status,
    );
    return rows.map((r) => ({ id: r.id, userId: r.user_id }));
  },

  async setRole(
    eventId: string,
    userId: string,
    role: EventRole,
  ): Promise<EventMember | null> {
    await run(
      "UPDATE event_member SET role = ? WHERE event_id = ? AND user_id = ? AND status <> 'canceled'",
      role,
      eventId,
      userId,
    );
    return this.find(eventId, userId);
  },

  async remove(eventId: string, userId: string): Promise<void> {
    await run(
      "DELETE FROM event_member WHERE event_id = ? AND user_id = ?",
      eventId,
      userId,
    );
  },

  /** 参加取消をキャンセル履歴として記録（行は残す） */
  async cancel(
    eventId: string,
    userId: string,
    wasScheduling: boolean,
  ): Promise<void> {
    await run(
      `UPDATE event_member
          SET status = 'canceled', canceled_at = ?, canceled_scheduling = ?
        WHERE event_id = ? AND user_id = ?`,
      Date.now(),
      wasScheduling ? 1 : 0,
      eventId,
      userId,
    );
  },

  /** 公開プロフィール用: 参加実績の集計。
   * 出席チェックなしのイベントは登録=出席、直前キャンセルは開始24時間以内の取消。 */
  async participationStats(
    userId: string,
    now: number,
  ): Promise<{
    attended: number;
    noShow: number;
    cancelEarly: number;
    cancelLate: number;
    hosted: number;
    staffed: number;
    spoken: number;
  }> {
    const DAY = 24 * 60 * 60 * 1000;
    const row = await one<{
      attended: number | null;
      no_show: number | null;
      cancel_early: number | null;
      cancel_late: number | null;
    }>(
      `SELECT
         SUM(CASE WHEN m.status = 'confirmed' AND e.ends_at > 0 AND e.ends_at < ?
                   AND (e.attendance_check = 0 OR m.attended = 1) THEN 1 ELSE 0 END) AS attended,
         SUM(CASE WHEN m.status = 'confirmed' AND e.ends_at > 0 AND e.ends_at < ?
                   AND e.attendance_check = 1 AND m.attended = 0 THEN 1 ELSE 0 END) AS no_show,
         SUM(CASE WHEN m.status = 'canceled' AND m.canceled_scheduling = 0 AND e.starts_at > 0
                   AND m.canceled_at < e.starts_at - ${DAY} THEN 1 ELSE 0 END) AS cancel_early,
         SUM(CASE WHEN m.status = 'canceled' AND m.canceled_scheduling = 0 AND e.starts_at > 0
                   AND m.canceled_at >= e.starts_at - ${DAY} THEN 1 ELSE 0 END) AS cancel_late
       FROM event_member m
       JOIN event e ON e.id = m.event_id
       WHERE m.user_id = ? AND m.role = 'participant' AND e.status = 'published'`,
      now,
      now,
      userId,
    );
    // 主催/スタッフともスタッフのメンバー行がある終了済み公開イベント基準
    // （プロフィールの一覧表示と一致させる。作成者はオーナーとして staff 行を持つ）
    const hosted = await one<{ v: number }>(
      `SELECT COUNT(*) AS v FROM event_member m
        JOIN event e ON e.id = m.event_id
        WHERE m.user_id = ? AND m.role = 'staff' AND m.status = 'confirmed'
          AND e.created_by = m.user_id AND e.status = 'published'
          AND e.ends_at > 0 AND e.ends_at < ?`,
      userId,
      now,
    );
    const staffed = await one<{ v: number }>(
      `SELECT COUNT(*) AS v FROM event_member m
        JOIN event e ON e.id = m.event_id
        WHERE m.user_id = ? AND m.role = 'staff' AND m.status = 'confirmed'
          AND e.created_by <> m.user_id AND e.status = 'published'
          AND e.ends_at > 0 AND e.ends_at < ?`,
      userId,
      now,
    );
    // 登壇: タイムテーブルの担当にリンクされた終了済み公開イベント数（重複コマは1と数える）
    const spoken = await one<{ v: number }>(
      `SELECT COUNT(DISTINCT e.id) AS v FROM event_schedule_item si
        JOIN event e ON e.id = si.event_id
        WHERE si.speaker_user_id = ? AND e.status = 'published'
          AND e.ends_at > 0 AND e.ends_at < ?`,
      userId,
      now,
    );
    return {
      attended: row?.attended ?? 0,
      noShow: row?.no_show ?? 0,
      cancelEarly: row?.cancel_early ?? 0,
      cancelLate: row?.cancel_late ?? 0,
      hosted: hosted?.v ?? 0,
      staffed: staffed?.v ?? 0,
      spoken: spoken?.v ?? 0,
    };
  },

  async listWithUsers(eventId: string): Promise<EventMemberWithUser[]> {
    const rows = await many<MemberUserRow>(
      `SELECT m.*, u.id AS u_id, u.discord_id AS u_discord_id,
                u.username AS u_username, u.global_name AS u_global_name,
                u.avatar_url AS u_avatar_url, u.created_at AS u_created_at
         FROM event_member m
         JOIN user u ON u.id = m.user_id
         WHERE m.event_id = ? AND m.status <> 'canceled'
           AND u.deleted_at IS NULL
         ORDER BY m.created_at ASC`,
      eventId,
    );
    return rows.map((row) => ({ ...toMember(row), user: toUser(row) }));
  },

  /** ユーザーが参加している全イベントを role 付きで返す（マイページ用） */
  async listEventsForUser(userId: string): Promise<MyEventSummary[]> {
    const rows = await many<Record<string, unknown> & { my_role: string }>(
      `SELECT e.*, m.role AS my_role, m.attended AS my_attended,
                (SELECT COUNT(1) FROM event_member em
                 WHERE em.event_id = e.id AND em.status = 'confirmed'
                   AND (e.attendance_check = 0 OR em.attended = 1 OR em.role <> 'participant')
                   AND ${COUNTED_MEMBER_IS_ACTIVE})
                 AS participant_count
         FROM event_member m
         JOIN event e ON e.id = m.event_id
         WHERE m.user_id = ? AND m.status <> 'canceled'
         ORDER BY e.starts_at DESC`,
      userId,
    );
    return rows.map(mapMyEventSummary);
  },

  /** 公開プロフィール用: 公開イベントのうち本人が確定参加しているもの。
   * 出席チェックモードのイベントは、参加者ロールなら出席済みのみ。 */
  async listPublicEventsForUser(userId: string): Promise<MyEventSummary[]> {
    const rows = await many<Record<string, unknown> & { my_role: string }>(
      `SELECT e.*, m.role AS my_role, m.attended AS my_attended,
                (SELECT COUNT(1) FROM event_member em
                 WHERE em.event_id = e.id AND em.status = 'confirmed'
                   AND (e.attendance_check = 0 OR em.attended = 1 OR em.role <> 'participant')
                   AND ${COUNTED_MEMBER_IS_ACTIVE})
                 AS participant_count
         FROM event_member m
         JOIN event e ON e.id = m.event_id
         WHERE m.user_id = ? AND m.status = 'confirmed' AND e.status = 'published'
           AND (e.attendance_check = 0 OR m.attended = 1 OR m.role <> 'participant')
         ORDER BY e.starts_at DESC`,
      userId,
    );
    return rows.map(mapMyEventSummary);
  },
};

function mapMyEventSummary(
  row: Record<string, unknown> & { my_role: string },
): MyEventSummary {
  return {
    id: row.id as string,
    title: row.title as string,
    subtitle: (row.subtitle as string) ?? "",
    description: row.description as string,
    startsAt: row.starts_at as number,
    endsAt: row.ends_at as number,
    venueType: row.venue_type as MyEventSummary["venueType"],
    venueOffline: (row.venue_offline as string | null) ?? null,
    venueOnline: (row.venue_online as string | null) ?? null,
    participationType:
      row.participation_type as MyEventSummary["participationType"],
    aggregateSelfEntry: (row.aggregate_self_entry as number) === 1,
    contestMode: (row.contest_mode as number) === 1,
    status: row.status as MyEventSummary["status"],
    createdBy: row.created_by as string,
    createdAt: row.created_at as number,
    imageUpdatedAt: (row.image_updated_at as number | null) ?? null,
    participantCount: (row.participant_count as number) ?? 0,
    communityId: (row.community_id as string | null) ?? null,
    scheduling: (row.scheduling as number) === 1,
    scheduleAnonymous: (row.schedule_anonymous as number) === 1,
    scheduleVisible: (row.schedule_visible as number) === 1,
    photosPublic: (row.photos_public as number) === 1,
    attendanceCheck: (row.attendance_check as number) === 1,
    venueWanted: (row.venue_wanted as number) === 1,
    chatEnabled: (row.chat_enabled as number) === 1,
    chatUrlsAllowed: (row.chat_urls_allowed as number) === 1,
    slug: (row.slug as string | null) ?? "",
    myRole: row.my_role as EventRole,
    attended: (row.my_attended as number) === 1,
  };
}
