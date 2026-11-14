import type { EventMember, EventRole } from "@eventer/shared";
import { batch } from "../client.js";
import { eventViewSql } from "../../auth/eventAccess.js";
import { accessOperationGuard, activeManagerSql, adminIds } from "./eventAccessInvites.js";
import { waitlistPromotionStatements } from "./waitlistPromotion.js";
import { groupChatRepo } from "./groupChat.js";
import { finishWaitlistPromotion } from "../../lib/waitlist.js";

/** The read-side slot is usable only while this exact membership still exists. */
export const memberSnapshot = (member: EventMember | null) => member
  ? [member.id, member.role, member.status, member.slotId ?? ""].join("|") : "";
export const currentMemberSnapshotSql = `COALESCE((SELECT m.id || '|' || m.role || '|' || m.status || '|' || COALESCE(m.slot_id,'')
  FROM event_member m WHERE m.event_id=e.id AND m.user_id=? AND m.status <> 'canceled'), '') = ?`;

/** No role means self-leave; participant means manager-directed removal; other
 * roles retain the existing Entry policy. Key rotation still runs after a
 * successful staff loss, outside the DB batch, and before delivering notices.
 *
 * `staffCancel`: a manager marks a confirmed participant as cancelled (「キャンセル扱い」).
 * Same effects as a self-leave (the cancelled row stays, Entry and survey answers go,
 * waitlist promotion), but the actor is checked as a manager and it is allowed after the
 * event has started or ended (the notice can arrive after the start). A member who was
 * checked in (`attended = 1`) is never rewritten. After the end there is nobody to promote, and
 * the individual Entry and survey answers are kept (scores, awards and answers stay on record). */
export async function changeMembership(eventId: string, actorId: string, userId: string,
  before: EventMember | null, role?: EventRole, opts?: { staffCancel?: boolean; eventEnded?: boolean }) {
  const token = crypto.randomUUID(), noticeId = crypto.randomUUID(), now = Date.now(), guard = [eventId, token];
  const staffCancel = opts?.staffCancel === true;
  const leaving = role === undefined || role === "participant" || staffCancel;
  const staffLoss = !staffCancel && before?.role === "staff" && role !== "staff";
  const selfLeave = role === undefined && !staffCancel;
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_operation_token=?,access_revision=access_revision+1 WHERE e.id=?
        AND ${selfLeave ? "? = ?" : activeManagerSql("e", "?")}
        ${role === "participant" || staffCancel ? "" : `AND EXISTS (SELECT 1 FROM user u WHERE u.id=? AND u.deleted_at IS NULL AND ${eventViewSql("e", "u.id", "?")})`}
        AND ${currentMemberSnapshotSql}
        ${staffCancel
          ? `AND EXISTS (SELECT 1 FROM event_member sc WHERE sc.event_id=e.id AND sc.user_id=? AND sc.role='participant'
              AND sc.status='confirmed' AND sc.attended=0) AND e.status='published'`
          : leaving ? "AND (e.scheduling=1 OR e.ends_at >= ?)" : ""}
        ${staffLoss && role !== undefined ? `AND (SELECT COUNT(*) FROM event_member staff JOIN user su ON su.id=staff.user_id AND su.deleted_at IS NULL
          WHERE staff.event_id=e.id AND staff.role='staff' AND staff.status <> 'canceled') > 1` : ""}`,
      args: [token, eventId, ...(selfLeave ? [actorId, userId] : [actorId, adminIds()]),
        ...(role === "participant" || staffCancel ? [] : [userId, adminIds()]), userId, memberSnapshot(before),
        ...(staffCancel ? [userId] : leaving ? [now] : [])] },
    ...(leaving ? [
      // 終了後のキャンセル扱いでは個人 Entry とアンケート回答を消さない（採点・表彰・回答の記録を残す）
      ...(staffCancel && opts?.eventEnded ? [] : [
        { sql: `DELETE FROM entry WHERE event_id=? AND kind='individual' AND id IN (SELECT entry_id FROM entry_member WHERE user_id=?) AND ${accessOperationGuard}`, args: [eventId, userId, ...guard] },
        { sql: `DELETE FROM event_survey_answer WHERE event_id=? AND user_id=? AND ${accessOperationGuard}`, args: [eventId, userId, ...guard] },
      ]),
      { sql: `DELETE FROM event_member WHERE event_id=? AND user_id=? AND NOT (role='participant' AND status='confirmed'
          AND EXISTS (SELECT 1 FROM event WHERE id=? AND status='published')) AND ${accessOperationGuard}`, args: [eventId, userId, eventId, ...guard] },
      { sql: `UPDATE event_member SET status='canceled',canceled_at=?,canceled_scheduling=(SELECT scheduling FROM event WHERE id=?)
          WHERE event_id=? AND user_id=? AND role='participant' AND status='confirmed' AND ${accessOperationGuard}`, args: [now, eventId, eventId, userId, ...guard] },
    ] : [
      // 申し込んでいた枠は、席を空けたうえで表示の並び (assigned_slot_id) として残す（SET の式は更新前の行で評価される）
      { sql: `UPDATE event_member SET role=?,assigned_slot_id=COALESCE(slot_id,assigned_slot_id),slot_id=NULL,status='confirmed' WHERE event_id=? AND user_id=? AND ${accessOperationGuard}`, args: [role, eventId, userId, ...guard] },
    ]),
    ...(before?.slotId && before.status === "confirmed" && !opts?.eventEnded
      ? waitlistPromotionStatements(eventId, before.slotId, token, noticeId, now) : []),
    { sql: "UPDATE event SET access_operation_token=NULL WHERE id=? AND access_operation_token=?", args: guard },
  ]);
  if (!changed) return null;
  if (staffLoss) await groupChatRepo.onStaffLost(eventId, userId);
  return { promotedUserId: await finishWaitlistPromotion(eventId, noticeId) };
}
