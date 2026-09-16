import { deferBackground } from "../runtime.js";
import type { Event } from "@eventer/shared";
import { batch, one } from "../db/client.js";
import { eligibleWaiterSql, waitlistPromotionStatements } from "../db/repositories/waitlistPromotion.js";
import { adminIds } from "../db/repositories/eventAccessInvites.js";
import { sendNotificationEmailIfOptedIn } from "./email.js";

/** Promote one currently qualified first-come waiter. Capacity, membership,
 * Entry, revision and the app notification commit together; concurrent callers
 * cannot allocate the same vacancy or leave an orphan Entry after revocation.
 * The caller is still responsible for releasing the previous seat. */
export async function promoteFromWaitlist(event: Event, slotId: string): Promise<string | null> {
  const token = crypto.randomUUID(), noticeId = crypto.randomUUID(), now = Date.now();
  const guard = [event.id, token];
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_operation_token = ?, access_revision = access_revision + 1
        WHERE e.id = ? AND EXISTS (SELECT 1 FROM participation_slot s
          WHERE s.id = ? AND s.event_id = e.id AND s.selection_type = 'first_come'
            AND (SELECT COUNT(*) FROM event_member seats WHERE seats.slot_id = s.id AND seats.status = 'confirmed') < s.capacity
            AND EXISTS (SELECT 1 FROM event_member m WHERE m.event_id = e.id AND m.slot_id = s.id AND ${eligibleWaiterSql}))`,
      args: [token, event.id, slotId, adminIds()] },
    ...waitlistPromotionStatements(event.id, slotId, token, noticeId, now),
    { sql: "UPDATE event SET access_operation_token = NULL WHERE id = ? AND access_operation_token = ?", args: guard },
  ]);
  if (!changed) return null;
  return finishWaitlistPromotion(event.id, noticeId);
}

export async function finishWaitlistPromotion(eventId: string, noticeId: string): Promise<string | null> {
  const notice = await one<{ user_id: string; title: string; body: string; link: string }>(
    "SELECT user_id,title,body,link FROM notification WHERE id = ?", noticeId);
  if (!notice) return null;
  await deferBackground(sendNotificationEmailIfOptedIn(notice.user_id, notice.title, notice.body, notice.link, { authorizationEventId: eventId }));
  return notice.user_id;
}
