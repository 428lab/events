import { batch } from "../client.js";
import { eventViewSql } from "../../auth/eventAccess.js";
import { accessOperationGuard, adminIds } from "./eventAccessInvites.js";

/** A private join must not create an Entry after another request revokes access.
 * Route-level questionnaire/slot validation is retained; current access, event
 * state and capacity are decided again inside this membership+Entry batch. */
export async function joinPrivateEvent(eventId: string, userId: string, slotId: string | null) {
  const token = crypto.randomUUID(), now = Date.now(), entryId = crypto.randomUUID();
  const guard = [eventId, token];
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_operation_token = ?, access_revision = access_revision + 1
        WHERE e.id = ? AND e.visibility = 'private' AND e.status = 'published'
          AND (e.scheduling = 1 OR e.ends_at >= ?) AND (e.registration_deadline IS NULL OR e.registration_deadline > ?)
          AND ${eventViewSql("e", "?", "?")}
          AND NOT EXISTS (SELECT 1 FROM event_member m WHERE m.event_id = e.id AND m.user_id = ? AND m.status <> 'canceled')
          AND (? IS NULL OR EXISTS (SELECT 1 FROM participation_slot s WHERE s.id = ? AND s.event_id = e.id))`,
      args: [token, eventId, now, now, userId, adminIds(), userId, slotId, slotId] },
    { sql: `INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, created_at)
        SELECT ?, ?, ?, 'participant', ?, COALESCE((SELECT CASE WHEN s.selection_type = 'lottery' THEN 'applied'
          WHEN (SELECT COUNT(*) FROM event_member m WHERE m.slot_id = s.id AND m.status = 'confirmed') < s.capacity
          THEN 'confirmed' ELSE 'waitlist' END FROM participation_slot s WHERE s.id = ?), 'confirmed'), ?
        WHERE ${accessOperationGuard}
        ON CONFLICT(event_id,user_id) DO UPDATE SET role = 'participant', slot_id = excluded.slot_id,
          status = excluded.status, created_at = excluded.created_at, attended = 0, attended_at = NULL,
          canceled_at = NULL, canceled_scheduling = 0 WHERE event_member.status = 'canceled'`,
      args: [crypto.randomUUID(), eventId, userId, slotId, slotId, now, ...guard] },
    { sql: `INSERT INTO entry (id, event_id, kind, name, created_at)
        SELECT ?, ?, 'individual', COALESCE(u.global_name,u.username), ? FROM user u WHERE u.id = ?
          AND EXISTS (SELECT 1 FROM event_member m WHERE m.event_id = ? AND m.user_id = u.id AND m.status = 'confirmed')
          AND NOT EXISTS (SELECT 1 FROM entry e JOIN entry_member em ON em.entry_id = e.id
            WHERE e.event_id = ? AND e.kind = 'individual' AND em.user_id = u.id) AND ${accessOperationGuard}`,
      args: [entryId, eventId, now, userId, eventId, eventId, ...guard] },
    { sql: `INSERT INTO entry_member (id, entry_id, user_id, is_leader)
        SELECT ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM entry WHERE id = ?) AND ${accessOperationGuard}`,
      args: [crypto.randomUUID(), entryId, userId, entryId, ...guard] },
    { sql: "UPDATE event SET access_operation_token = NULL WHERE id = ? AND access_operation_token = ?", args: guard },
  ]);
  return Boolean(changed);
}
