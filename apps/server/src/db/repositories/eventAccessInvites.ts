import type { EventAccessInvite, EventAccessInviteStatus, MyEventInvite } from "@eventer/shared";
import { EVENT_ACCESS_INVITE_TTL_MS } from "@eventer/shared";
import { batch, many, one } from "../client.js";
import { eventManagerSql } from "../../auth/eventAccess.js";
import { env } from "../../env.js";

export interface AccessInviteRow {
  id: string; event_id: string; user_id: string; invited_by: string | null;
  status: "pending" | "accepted" | "declined" | "revoked";
  source: "invite" | "existing_member"; created_at: number;
  expires_at: number | null; responded_at: number | null;
}
export const accessInviteStatus = (i: AccessInviteRow, now = Date.now()): EventAccessInviteStatus =>
  i.status === "pending" && (i.expires_at ?? 0) <= now ? "expired" : i.status;
export const accessOperationGuard = "EXISTS (SELECT 1 FROM event WHERE id = ? AND access_operation_token = ?)";
export const activeManagerSql = (event: string, userId: string) =>
  `EXISTS (SELECT 1 FROM user manager WHERE manager.id = ${userId} AND manager.deleted_at IS NULL
    AND ${eventManagerSql(event, "manager", "?")})`;
export const adminIds = () => JSON.stringify(env.adminDiscordIds);

export const eventAccessInvitesRepo = {
  find(id: string) {
    return one<AccessInviteRow>("SELECT * FROM event_access_invite WHERE id = ?", id);
  },
  findForUser(eventId: string, userId: string) {
    return one<AccessInviteRow>("SELECT * FROM event_access_invite WHERE event_id = ? AND user_id = ?", eventId, userId);
  },
  async list(eventId: string): Promise<EventAccessInvite[]> {
    const rows = await many<AccessInviteRow & { handle: string; displayName: string }>(
      `SELECT i.*, u.username AS handle, COALESCE(u.global_name, u.username) AS displayName
       FROM event_access_invite i JOIN user u ON u.id = i.user_id AND u.deleted_at IS NULL
       WHERE i.event_id = ? ORDER BY i.created_at DESC, i.id DESC`, eventId);
    return rows.map((i) => ({ id: i.id, userId: i.user_id, handle: i.handle, displayName: i.displayName,
      status: accessInviteStatus(i), source: i.source, expiresAt: i.expires_at, createdAt: i.created_at }));
  },
  async pending(userId: string, limit: number, cursor?: [number, string]) {
    const rows = await many<AccessInviteRow & { title: string; inviterName: string | null }>(
      `SELECT i.*, e.title, COALESCE(u.global_name, u.username) AS inviterName
       FROM event_access_invite i JOIN event e ON e.id = i.event_id AND e.visibility = 'private'
       LEFT JOIN user u ON u.id = i.invited_by AND u.deleted_at IS NULL
       WHERE i.user_id = ? AND i.status = 'pending' AND i.expires_at > ?
       ${cursor ? "AND (i.created_at, i.id) < (?, ?)" : ""}
       ORDER BY i.created_at DESC, i.id DESC LIMIT ?`, userId, Date.now(), ...(cursor ?? []), limit + 1);
    const page = rows.slice(0, limit);
    return { invites: page.map((i): MyEventInvite => ({ id: i.id, title: i.title, inviterName: i.inviterName,
      expiresAt: i.expires_at!, status: "pending" })), nextCursor: nextCursor(rows, limit) };
  },
  async accepted(userId: string, limit: number, cursor?: [number, string]) {
    return many<AccessInviteRow>(`SELECT i.* FROM event_access_invite i
      JOIN event e ON e.id = i.event_id AND e.visibility = 'private'
      WHERE i.user_id = ? AND i.status = 'accepted'
      ${cursor ? "AND (i.created_at, i.id) < (?, ?)" : ""}
      ORDER BY i.created_at DESC, i.id DESC LIMIT ?`, userId, ...(cursor ?? []), limit + 1);
  },
  /** One token-owned batch; stale revision, renamed handle and concurrent acceptance
   * cannot produce an invite, revision increment or notification. */
  async issue(eventId: string, actorId: string, targetId: string, revision: number,
    handle: string, oldId?: string) {
    const id = crypto.randomUUID(), token = crypto.randomUUID(), now = Date.now();
    const guard = [eventId, token];
    const [changed] = await batch([
      { sql: `UPDATE event AS e SET access_revision = access_revision + 1, access_operation_token = ?
          WHERE e.id = ? AND e.visibility = 'private' AND e.access_revision = ?
          AND ${activeManagerSql("e", "?")}
          AND EXISTS (SELECT 1 FROM user target WHERE target.id = ? AND target.deleted_at IS NULL
            AND target.username = ? COLLATE NOCASE AND NOT ${eventManagerSql("e", "target", "?")})
          AND ${oldId
            ? "EXISTS (SELECT 1 FROM event_access_invite i WHERE i.id = ? AND i.event_id = e.id AND i.user_id = ? AND i.status <> 'accepted')"
            : "NOT EXISTS (SELECT 1 FROM event_access_invite i WHERE i.event_id = e.id AND i.user_id = ? AND (i.status = 'accepted' OR (i.status = 'pending' AND i.expires_at > ?)))"}`,
        args: [token, eventId, revision, actorId, adminIds(), targetId, handle, adminIds(),
          ...(oldId ? [oldId, targetId] : [targetId, now])] },
      { sql: `INSERT INTO event_access_invite (id, event_id, user_id, invited_by, status, source, created_at, expires_at)
          SELECT ?, ?, ?, ?, 'pending', 'invite', ?, ? WHERE ${accessOperationGuard}
          ON CONFLICT(event_id, user_id) DO UPDATE SET id = excluded.id, invited_by = excluded.invited_by,
            status = 'pending', source = 'invite', created_at = excluded.created_at,
            expires_at = excluded.expires_at, responded_at = NULL`,
        args: [id, eventId, targetId, actorId, now, now + EVENT_ACCESS_INVITE_TTL_MS, ...guard] },
      { sql: `INSERT INTO notification (id, user_id, type, title, body, link, created_at, actor_id, event_id)
          SELECT ?, ?, 'event_access_invite', '閲覧への招待が届きました', '', '/event-invites', ?, ?, ?
          WHERE ${accessOperationGuard}`, args: [crypto.randomUUID(), targetId, now, actorId, eventId, ...guard] },
      { sql: "UPDATE event SET access_operation_token = NULL WHERE id = ? AND access_operation_token = ?", args: guard },
    ]);
    return changed ? id : null;
  },
  async respond(invite: AccessInviteRow, userId: string, action: "accepted" | "declined") {
    const token = crypto.randomUUID(), now = Date.now();
    const guard = [invite.event_id, token];
    const [changed] = await batch([
      { sql: `UPDATE event AS e SET access_revision = access_revision + 1, access_operation_token = ?
          WHERE e.id = ? AND e.visibility = 'private'
          AND EXISTS (SELECT 1 FROM user u WHERE u.id = ? AND u.deleted_at IS NULL)
          AND EXISTS (SELECT 1 FROM event_access_invite i WHERE i.id = ? AND i.event_id = e.id
            AND i.user_id = ? AND i.status = 'pending' AND i.expires_at > ?
            ${action === "accepted" ? `AND ${activeManagerSql("e", "i.invited_by")}` : ""})`,
        args: [token, invite.event_id, userId, invite.id, userId, now, ...(action === "accepted" ? [adminIds()] : [])] },
      { sql: `UPDATE event_access_invite SET status = ?, responded_at = ? WHERE id = ? AND ${accessOperationGuard}`,
        args: [action, now, invite.id, ...guard] },
      { sql: "UPDATE event SET access_operation_token = NULL WHERE id = ? AND access_operation_token = ?", args: guard },
    ]);
    return Boolean(changed);
  },
};

export function nextCursor(rows: AccessInviteRow[], limit: number): string | null {
  const last = rows[limit - 1];
  return rows.length > limit && last ? btoa(JSON.stringify([last.created_at, last.id])) : null;
}
