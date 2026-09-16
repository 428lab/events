import type { EventMember, EventRole } from "@eventer/shared";
import { batch } from "../client.js";
import { eventViewSql } from "../../auth/eventAccess.js";
import { accessOperationGuard, activeManagerSql, adminIds } from "./eventAccessInvites.js";
import { waitlistPromotionStatements } from "./waitlistPromotion.js";
import { staffChatRepo } from "./staffChat.js";
import { finishWaitlistPromotion } from "../../lib/waitlist.js";

/** The read-side slot is usable only while this exact membership still exists. */
export const memberSnapshot = (member: EventMember | null) => member
  ? [member.id, member.role, member.status, member.slotId ?? ""].join("|") : "";
export const currentMemberSnapshotSql = `COALESCE((SELECT m.id || '|' || m.role || '|' || m.status || '|' || COALESCE(m.slot_id,'')
  FROM event_member m WHERE m.event_id=e.id AND m.user_id=? AND m.status <> 'canceled'), '') = ?`;

/** No role means self-leave; participant means manager-directed removal; other
 * roles retain the existing Entry policy. Key rotation still runs after a
 * successful staff loss, outside the DB batch, and before delivering notices. */
export async function changeMembership(eventId: string, actorId: string, userId: string,
  before: EventMember | null, role?: EventRole) {
  const token = crypto.randomUUID(), noticeId = crypto.randomUUID(), now = Date.now(), guard = [eventId, token];
  const leaving = role === undefined || role === "participant";
  const staffLoss = before?.role === "staff" && role !== "staff";
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_operation_token=?,access_revision=access_revision+1 WHERE e.id=?
        AND ${role === undefined ? "? = ?" : activeManagerSql("e", "?")}
        AND EXISTS (SELECT 1 FROM user u WHERE u.id=? AND u.deleted_at IS NULL AND ${eventViewSql("e", "u.id", "?")})
        AND ${currentMemberSnapshotSql}
        ${leaving ? "AND (e.scheduling=1 OR e.ends_at >= ?)" : ""}
        ${staffLoss && role !== undefined ? `AND (SELECT COUNT(*) FROM event_member staff JOIN user su ON su.id=staff.user_id AND su.deleted_at IS NULL
          WHERE staff.event_id=e.id AND staff.role='staff' AND staff.status <> 'canceled') > 1` : ""}`,
      args: [token, eventId, ...(role === undefined ? [actorId, userId] : [actorId, adminIds()]), userId, adminIds(), userId, memberSnapshot(before), ...(leaving ? [now] : [])] },
    ...(leaving ? [
      { sql: `DELETE FROM entry WHERE event_id=? AND kind='individual' AND id IN (SELECT entry_id FROM entry_member WHERE user_id=?) AND ${accessOperationGuard}`, args: [eventId, userId, ...guard] },
      { sql: `DELETE FROM event_survey_answer WHERE event_id=? AND user_id=? AND ${accessOperationGuard}`, args: [eventId, userId, ...guard] },
      { sql: `DELETE FROM event_member WHERE event_id=? AND user_id=? AND NOT (role='participant' AND status='confirmed'
          AND EXISTS (SELECT 1 FROM event WHERE id=? AND status='published')) AND ${accessOperationGuard}`, args: [eventId, userId, eventId, ...guard] },
      { sql: `UPDATE event_member SET status='canceled',canceled_at=?,canceled_scheduling=(SELECT scheduling FROM event WHERE id=?)
          WHERE event_id=? AND user_id=? AND role='participant' AND status='confirmed' AND ${accessOperationGuard}`, args: [now, eventId, eventId, userId, ...guard] },
    ] : [
      { sql: `UPDATE event_member SET role=?,slot_id=NULL,status='confirmed' WHERE event_id=? AND user_id=? AND ${accessOperationGuard}`, args: [role, eventId, userId, ...guard] },
    ]),
    ...(before?.slotId && before.status === "confirmed" ? waitlistPromotionStatements(eventId, before.slotId, token, noticeId, now) : []),
    { sql: "UPDATE event SET access_operation_token=NULL WHERE id=? AND access_operation_token=?", args: guard },
  ]);
  if (!changed) return null;
  if (staffLoss) await staffChatRepo.onStaffLost(eventId, userId);
  return { promotedUserId: await finishWaitlistPromotion(eventId, noticeId) };
}
