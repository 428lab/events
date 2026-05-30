import type {
  EventMember,
  EventMemberWithUser,
  EventRole,
  MyEventSummary,
  User,
} from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";

interface MemberRow {
  id: string;
  event_id: string;
  user_id: string;
  role: string;
  slot_id: string | null;
  status: string;
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
  find(eventId: string, userId: string): EventMember | null {
    const row = db
      .prepare("SELECT * FROM event_member WHERE event_id = ? AND user_id = ?")
      .get(eventId, userId) as MemberRow | undefined;
    return row ? toMember(row) : null;
  },

  add(
    eventId: string,
    userId: string,
    role: EventRole,
    slotId: string | null = null,
    status = "confirmed",
  ): EventMember {
    const existing = this.find(eventId, userId);
    if (existing) return existing;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, eventId, userId, role, slotId, status, Date.now());
    return this.find(eventId, userId)!;
  },

  /** 抽選などで状態を更新 */
  setStatus(memberId: string, status: string): void {
    db.prepare("UPDATE event_member SET status = ? WHERE id = ?").run(
      status,
      memberId,
    );
  },

  /** 枠の特定状態のメンバー（抽選用） */
  membersBySlotStatus(
    slotId: string,
    status: string,
  ): Array<{ id: string; userId: string }> {
    const rows = db
      .prepare(
        "SELECT id, user_id FROM event_member WHERE slot_id = ? AND status = ?",
      )
      .all(slotId, status) as Array<{ id: string; user_id: string }>;
    return rows.map((r) => ({ id: r.id, userId: r.user_id }));
  },

  setRole(eventId: string, userId: string, role: EventRole): EventMember | null {
    db.prepare(
      "UPDATE event_member SET role = ? WHERE event_id = ? AND user_id = ?",
    ).run(role, eventId, userId);
    return this.find(eventId, userId);
  },

  remove(eventId: string, userId: string): void {
    db.prepare(
      "DELETE FROM event_member WHERE event_id = ? AND user_id = ?",
    ).run(eventId, userId);
  },

  listWithUsers(eventId: string): EventMemberWithUser[] {
    const rows = db
      .prepare(
        `SELECT m.*, u.id AS u_id, u.discord_id AS u_discord_id,
                u.username AS u_username, u.global_name AS u_global_name,
                u.avatar_url AS u_avatar_url, u.created_at AS u_created_at
         FROM event_member m
         JOIN user u ON u.id = m.user_id
         WHERE m.event_id = ?
         ORDER BY m.created_at ASC`,
      )
      .all(eventId) as MemberUserRow[];
    return rows.map((row) => ({ ...toMember(row), user: toUser(row) }));
  },

  /** ユーザーが参加している全イベントを role 付きで返す（マイページ用） */
  listEventsForUser(userId: string): MyEventSummary[] {
    const rows = db
      .prepare(
        `SELECT e.*, m.role AS my_role,
                (SELECT COUNT(1) FROM event_member em
                 WHERE em.event_id = e.id AND em.status = 'confirmed') AS participant_count
         FROM event_member m
         JOIN event e ON e.id = m.event_id
         WHERE m.user_id = ?
         ORDER BY e.starts_at DESC`,
      )
      .all(userId) as Array<
      Record<string, unknown> & { my_role: string }
    >;
    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      startsAt: row.starts_at as number,
      endsAt: row.ends_at as number,
      venueType: row.venue_type as MyEventSummary["venueType"],
      venueOffline: (row.venue_offline as string | null) ?? null,
      venueOnline: (row.venue_online as string | null) ?? null,
      participationType:
        row.participation_type as MyEventSummary["participationType"],
      aggregateSelfEntry: (row.aggregate_self_entry as number) === 1,
      status: row.status as MyEventSummary["status"],
      createdBy: row.created_by as string,
      createdAt: row.created_at as number,
      imageUpdatedAt: (row.image_updated_at as number | null) ?? null,
      participantCount: (row.participant_count as number) ?? 0,
      myRole: row.my_role as EventRole,
    }));
  },
};
