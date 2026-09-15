import type { Event } from "@eventer/shared";
import { batch, one } from "../db/client.js";
import { eventViewSql } from "../auth/eventAccess.js";
import { accessOperationGuard, adminIds } from "../db/repositories/eventAccessInvites.js";
import { sendNotificationEmailIfOptedIn } from "./email.js";

/** Promote one currently qualified first-come waiter. Capacity, membership,
 * Entry, revision and the app notification commit together; concurrent callers
 * cannot allocate the same vacancy or leave an orphan Entry after revocation.
 * The caller is still responsible for releasing the previous seat. */
export async function promoteFromWaitlist(event: Event, slotId: string): Promise<string | null> {
  const token = crypto.randomUUID(), noticeId = crypto.randomUUID(), entryId = crypto.randomUUID(), now = Date.now();
  const guard = [event.id, token];
  const eligible = `m.role = 'participant' AND m.status = 'waitlist'
    AND EXISTS (SELECT 1 FROM user u WHERE u.id = m.user_id AND u.deleted_at IS NULL)
    AND ${eventViewSql("e", "m.user_id", "?")}`;
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_operation_token = ?, access_revision = access_revision + 1
        WHERE e.id = ? AND EXISTS (SELECT 1 FROM participation_slot s
          WHERE s.id = ? AND s.event_id = e.id AND s.selection_type = 'first_come'
            AND (SELECT COUNT(*) FROM event_member seats WHERE seats.slot_id = s.id AND seats.status = 'confirmed') < s.capacity
            AND EXISTS (SELECT 1 FROM event_member m WHERE m.event_id = e.id AND m.slot_id = s.id AND ${eligible}))`,
      args: [token, event.id, slotId, adminIds()] },
    { sql: `INSERT INTO notification(id,user_id,type,title,body,link,created_at,event_id)
        SELECT ?, m.user_id, 'waitlist_promoted', 'キャンセル待ちから繰り上がりました',
          CASE WHEN e.visibility = 'public' THEN '「' || e.title || '」への参加が確定しました'
          ELSE 'イベントの更新があります' END, ?, ?, e.id
        FROM event_member m JOIN event e ON e.id = m.event_id
        WHERE m.slot_id = ? AND e.id = ? AND ${eligible} AND ${accessOperationGuard}
        ORDER BY m.created_at, m.rowid LIMIT 1`,
      args: [noticeId, `/events/${event.id}`, now, slotId, event.id, adminIds(), ...guard] },
    { sql: `UPDATE event_member SET status = 'confirmed' WHERE event_id = ? AND status = 'waitlist'
        AND user_id = (SELECT user_id FROM notification WHERE id = ?) AND ${accessOperationGuard}`,
      args: [event.id, noticeId, ...guard] },
    { sql: `INSERT INTO entry(id,event_id,kind,name,created_at)
        SELECT ?, ?, 'individual', COALESCE(u.global_name,u.username), ? FROM notification n JOIN user u ON u.id = n.user_id
        WHERE n.id = ? AND ${accessOperationGuard} AND NOT EXISTS (
          SELECT 1 FROM entry e JOIN entry_member em ON em.entry_id = e.id
          WHERE e.event_id = ? AND e.kind = 'individual' AND em.user_id = u.id)`,
      args: [entryId, event.id, now, noticeId, ...guard, event.id] },
    { sql: `INSERT INTO entry_member(id,entry_id,user_id,is_leader) SELECT ?, ?, user_id, 1 FROM notification
        WHERE id = ? AND EXISTS (SELECT 1 FROM entry WHERE id = ?) AND ${accessOperationGuard}`,
      args: [crypto.randomUUID(), entryId, noticeId, entryId, ...guard] },
    { sql: "UPDATE event SET access_operation_token = NULL WHERE id = ? AND access_operation_token = ?", args: guard },
  ]);
  if (!changed) return null;
  const notice = await one<{ user_id: string; title: string; body: string; link: string }>(
    "SELECT user_id,title,body,link FROM notification WHERE id = ?", noticeId);
  if (!notice) return null;
  await sendNotificationEmailIfOptedIn(notice.user_id, notice.title, notice.body, notice.link, { authorizationEventId: event.id });
  return notice.user_id;
}
