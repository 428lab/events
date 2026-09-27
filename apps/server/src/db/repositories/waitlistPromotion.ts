import { eventViewSql } from "../../auth/eventAccess.js";
import { accessOperationGuard, adminIds } from "./eventAccessInvites.js";

export const eligibleWaiterSql = `m.role = 'participant' AND m.status = 'waitlist'
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = m.user_id AND u.deleted_at IS NULL)
    AND ${eventViewSql("e", "m.user_id", "?")}`;

/** Append to a token-owned membership batch AFTER releasing its previous seat. */
export function waitlistPromotionStatements(eventId: string, slotId: string, token: string, noticeId: string, now: number) {
  const guard = [eventId, token], entryId = crypto.randomUUID();
  return [
    { sql: `INSERT INTO notification(id,user_id,type,title,body,link,created_at,event_id)
        SELECT ?, m.user_id, 'waitlist_promoted', 'キャンセル待ちから繰り上がりました',
          CASE WHEN e.visibility = 'public' THEN '「' || e.title || '」への参加が確定しました'
          ELSE 'イベントの更新があります' END, ?, ?, e.id
        FROM event_member m JOIN event e ON e.id = m.event_id
        WHERE m.slot_id = ? AND e.id = ? AND ${eligibleWaiterSql} AND ${accessOperationGuard}
          AND EXISTS (SELECT 1 FROM participation_slot s WHERE s.id=m.slot_id AND s.event_id=e.id AND s.selection_type='first_come'
            AND (SELECT COUNT(*) FROM event_member held WHERE held.slot_id=s.id AND held.status='confirmed') < s.capacity)
        ORDER BY m.created_at, m.rowid LIMIT 1`,
      args: [noticeId, `/events/${eventId}`, now, slotId, eventId, adminIds(), ...guard] },
    { sql: `UPDATE event_member SET status = 'confirmed' WHERE event_id = ? AND status = 'waitlist'
        AND user_id = (SELECT user_id FROM notification WHERE id = ?) AND ${accessOperationGuard}`,
      args: [eventId, noticeId, ...guard] },
    { sql: `INSERT INTO entry(id,event_id,kind,name,created_at)
        SELECT ?, ?, 'individual', COALESCE(u.global_name,u.username), ? FROM notification n JOIN user u ON u.id = n.user_id
        WHERE n.id = ? AND ${accessOperationGuard} AND NOT EXISTS (
          SELECT 1 FROM entry e JOIN entry_member em ON em.entry_id = e.id
          WHERE e.event_id = ? AND e.kind = 'individual' AND em.user_id = u.id)`,
      args: [entryId, eventId, now, noticeId, ...guard, eventId] },
    { sql: `INSERT INTO entry_member(id,entry_id,user_id,is_leader) SELECT ?, ?, user_id, 1 FROM notification
        WHERE id = ? AND EXISTS (SELECT 1 FROM entry WHERE id = ?) AND ${accessOperationGuard}`,
      args: [crypto.randomUUID(), entryId, noticeId, entryId, ...guard] },
  ];
}
