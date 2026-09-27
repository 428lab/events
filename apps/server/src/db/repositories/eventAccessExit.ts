import { batch } from "../client.js";
import { eventMembersRepo } from "./eventMembers.js";
import { accessOperationGuard, activeManagerSql, adminIds, type AccessInviteRow } from "./eventAccessInvites.js";
import { eventViewSql } from "../../auth/eventAccess.js";

/** Grant revocation and all pre-end participation cleanup share one transaction.
 * Managers are excluded by current SQL, never by a read-side role snapshot. */
export async function revokeEventAccess(invite: AccessInviteRow, actorId: string, revision?: number) {
  const token = crypto.randomUUID(), now = Date.now();
  const eventId = invite.event_id, targetId = invite.user_id;
  const before = await eventMembersRepo.findIncludingCanceled(eventId, targetId);
  // The slot released below is a read-side value. Claim only if the membership
  // identity/role/status/slot still matches; never promote a different slot.
  const snapshot = before ? [before.id, before.role, before.status, before.slotId ?? ""].join("|") : "";
  const guard = [eventId, token];
  const cleanup = `${accessOperationGuard} AND EXISTS (
    SELECT 1 FROM event_access_invite i JOIN event e ON e.id = i.event_id
    WHERE i.id = ? AND i.status = 'accepted' AND (e.scheduling = 1 OR e.ends_at >= ?))`;
  const cleanupArgs = [...guard, invite.id, now];
  const notificationId = crypto.randomUUID(), entryId = crypto.randomUUID();
  const promote = before?.status === "confirmed" && before.slotId !== null;
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_revision = access_revision + 1, access_operation_token = ?
        WHERE e.id = ? AND e.visibility = 'private'
          AND EXISTS (SELECT 1 FROM user actor WHERE actor.id = ? AND actor.deleted_at IS NULL)
          AND ${revision === undefined ? "? = ?" : `e.access_revision = ? AND ${activeManagerSql("e", "?")}`}
          AND NOT ${activeManagerSql("e", "?")}
          AND EXISTS (SELECT 1 FROM event_access_invite i WHERE i.id = ? AND i.event_id = e.id
            AND i.user_id = ? AND ${revision === undefined ? "i.status = 'accepted'" : "i.status <> 'revoked'"})
          AND COALESCE((SELECT m.id || '|' || m.role || '|' || m.status || '|' || COALESCE(m.slot_id, '')
            FROM event_member m WHERE m.event_id = e.id AND m.user_id = ?), '') = ?`,
      args: [token, eventId, actorId, ...(revision === undefined ? [actorId, targetId] : [revision, actorId, adminIds()]),
        targetId, adminIds(), invite.id, targetId, targetId, snapshot] },
    { sql: `DELETE FROM entry WHERE event_id = ? AND kind = 'individual'
        AND id IN (SELECT entry_id FROM entry_member WHERE user_id = ?) AND ${cleanup}`,
      args: [eventId, targetId, ...cleanupArgs] },
    { sql: `DELETE FROM event_survey_answer WHERE event_id = ? AND user_id = ? AND ${cleanup}`,
      args: [eventId, targetId, ...cleanupArgs] },
    { sql: `DELETE FROM event_member WHERE event_id = ? AND user_id = ? AND status <> 'canceled'
        AND NOT (role = 'participant' AND status = 'confirmed'
          AND EXISTS (SELECT 1 FROM event WHERE id = ? AND status = 'published')) AND ${cleanup}`,
      args: [eventId, targetId, eventId, ...cleanupArgs] },
    { sql: `UPDATE event_member SET status = 'canceled', canceled_at = ?,
        canceled_scheduling = (SELECT scheduling FROM event WHERE id = ?)
        WHERE event_id = ? AND user_id = ? AND role = 'participant' AND status = 'confirmed' AND ${cleanup}`,
      args: [now, eventId, eventId, targetId, ...cleanupArgs] },
    // A transaction-local notification ID records the one eligible promotion.
    // No mail side effect; retry after revoke is a no-op, so it cannot notify twice.
    ...(promote ? [
      { sql: `INSERT INTO notification (id, user_id, type, title, body, link, created_at, event_id)
          SELECT ?, m.user_id, 'waitlist_promoted', 'イベントの更新があります', '', ?, ?, e.id
          FROM event_member m JOIN event e ON e.id = m.event_id
          JOIN participation_slot s ON s.id = m.slot_id AND s.event_id = e.id
          WHERE m.slot_id = ? AND m.role = 'participant' AND m.status = 'waitlist'
            AND s.selection_type = 'first_come'
            AND (SELECT COUNT(*) FROM event_member seats WHERE seats.slot_id = s.id AND seats.status = 'confirmed') < s.capacity
            AND ${eventViewSql("e", "m.user_id", "?")} AND ${cleanup}
          ORDER BY m.created_at, m.rowid LIMIT 1`,
        args: [notificationId, `/events/${eventId}`, now, before!.slotId, adminIds(), ...cleanupArgs] },
      { sql: `UPDATE event_member SET status = 'confirmed' WHERE event_id = ? AND status = 'waitlist'
          AND user_id = (SELECT user_id FROM notification WHERE id = ?) AND ${accessOperationGuard}`,
        args: [eventId, notificationId, ...guard] },
      { sql: `INSERT INTO entry (id, event_id, kind, name, created_at)
          SELECT ?, ?, 'individual', COALESCE(u.global_name, u.username), ?
          FROM notification n JOIN user u ON u.id = n.user_id WHERE n.id = ?
            AND NOT EXISTS (SELECT 1 FROM entry en JOIN entry_member em ON em.entry_id = en.id
              WHERE en.event_id = ? AND en.kind = 'individual' AND em.user_id = u.id) AND ${accessOperationGuard}`,
        args: [entryId, eventId, now, notificationId, eventId, ...guard] },
      { sql: `INSERT INTO entry_member (id, entry_id, user_id, is_leader)
          SELECT ?, ?, user_id, 1 FROM notification WHERE id = ?
            AND EXISTS (SELECT 1 FROM entry WHERE id = ?) AND ${accessOperationGuard}`,
        args: [crypto.randomUUID(), entryId, notificationId, entryId, ...guard] },
    ] : []),
    { sql: `UPDATE event_access_invite SET status = 'revoked', responded_at = ? WHERE id = ? AND ${accessOperationGuard}`,
      args: [now, invite.id, ...guard] },
    { sql: "UPDATE event SET access_operation_token = NULL WHERE id = ? AND access_operation_token = ?", args: guard },
  ]);
  return Boolean(changed);
}
