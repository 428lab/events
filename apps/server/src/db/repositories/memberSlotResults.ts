import { batch, many } from "../client.js";
import { eventViewSql } from "../../auth/eventAccess.js";
import { accessOperationGuard, activeManagerSql, adminIds } from "./eventAccessInvites.js";
import { deferBackground } from "../../runtime.js";
import { sendNotificationEmailIfOptedIn } from "../../lib/email.js";

interface ResultNotice { user_id: string; type: string; title: string; body: string; link: string }
async function deliver(eventId: string, ids: string[]) {
  const notices = await many<ResultNotice>("SELECT user_id,type,title,body,link FROM notification WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  await Promise.all(notices.map(n => deferBackground(sendNotificationEmailIfOptedIn(n.user_id, n.title, n.body, n.link, { authorizationEventId: eventId }))));
  return notices;
}

/** Ordered member IDs are the existing JS shuffle, not authorization. Rank only
 * still-qualified applicants inside the batch and subtract already-held seats. */
export async function drawMemberSlots(eventId: string, actorId: string, slotId: string, orderedIds: string[]) {
  const token = crypto.randomUUID(), now = Date.now(), guard = [eventId, token];
  const candidates = orderedIds.map(memberId => ({ memberId, noticeId: crypto.randomUUID(), entryId: crypto.randomUUID(), entryMemberId: crypto.randomUUID() }));
  const source = JSON.stringify(candidates), ids = JSON.stringify(candidates.map(c => c.noticeId));
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_operation_token = ?, access_revision = access_revision + 1
        WHERE e.id = ? AND ${activeManagerSql("e", "?")}
          AND EXISTS (SELECT 1 FROM participation_slot s WHERE s.id = ? AND s.event_id = e.id AND s.selection_type = 'lottery')`,
      args: [token, eventId, actorId, adminIds(), slotId] },
    { sql: `INSERT INTO notification(id,user_id,type,title,body,link,created_at,event_id)
        WITH eligible AS (
          SELECT json_extract(j.value,'$.noticeId') notice_id, m.user_id, e.title event_title, e.visibility,
            ROW_NUMBER() OVER (ORDER BY CAST(j.key AS INTEGER)) position,
            MAX(0, s.capacity - (SELECT COUNT(*) FROM event_member held WHERE held.slot_id = s.id AND held.status = 'confirmed')) remaining
          FROM json_each(?) j JOIN event_member m ON m.id = json_extract(j.value,'$.memberId')
          JOIN event e ON e.id = m.event_id JOIN participation_slot s ON s.id = m.slot_id AND s.event_id = e.id
          JOIN user u ON u.id = m.user_id AND u.deleted_at IS NULL
          WHERE e.id = ? AND s.id = ? AND m.role = 'participant' AND m.status = 'applied'
            AND ${eventViewSql("e", "m.user_id", "?")} AND ${accessOperationGuard})
        SELECT notice_id,user_id,CASE WHEN position <= remaining THEN 'lottery_won' ELSE 'lottery_lost' END,
          CASE WHEN position <= remaining THEN '抽選に当選しました' ELSE '抽選結果のお知らせ' END,
          CASE WHEN visibility <> 'public' THEN 'イベントの更新があります'
            WHEN position <= remaining THEN '「' || event_title || '」の抽選に当選しました。参加が確定です'
            ELSE '「' || event_title || '」は今回は落選となりました' END, ?, ?, ? FROM eligible`,
      args: [source, eventId, slotId, adminIds(), ...guard, `/events/${eventId}`, now, eventId] },
    { sql: `WITH results AS (SELECT user_id,type FROM notification WHERE id IN (SELECT value FROM json_each(?)))
        UPDATE event_member SET status=CASE WHEN user_id IN (SELECT user_id FROM results WHERE type='lottery_won') THEN 'confirmed' ELSE 'lost' END,
          attended=CASE WHEN user_id IN (SELECT user_id FROM results WHERE type='lottery_won') THEN attended ELSE 0 END,
          attended_at=CASE WHEN user_id IN (SELECT user_id FROM results WHERE type='lottery_won') THEN attended_at ELSE NULL END
        WHERE event_id=? AND user_id IN (SELECT user_id FROM results) AND ${accessOperationGuard}`,
      args: [ids, eventId, ...guard] },
    { sql: `DELETE FROM entry WHERE event_id = ? AND kind = 'individual' AND id IN (
        SELECT em.entry_id FROM entry_member em JOIN notification n ON n.user_id = em.user_id
        WHERE n.id IN (SELECT value FROM json_each(?)) AND n.type = 'lottery_lost') AND ${accessOperationGuard}`,
      args: [eventId, ids, ...guard] },
    { sql: `INSERT INTO entry(id,event_id,kind,name,created_at)
        SELECT json_extract(j.value,'$.entryId'), ?, 'individual', COALESCE(u.global_name,u.username), ?
        FROM json_each(?) j JOIN notification n ON n.id = json_extract(j.value,'$.noticeId') AND n.type='lottery_won'
        JOIN user u ON u.id = n.user_id WHERE ${accessOperationGuard}
        AND NOT EXISTS (SELECT 1 FROM entry e JOIN entry_member em ON em.entry_id=e.id WHERE e.event_id=? AND e.kind='individual' AND em.user_id=u.id)`,
      args: [eventId, now, source, ...guard, eventId] },
    { sql: `INSERT INTO entry_member(id,entry_id,user_id,is_leader)
        SELECT json_extract(j.value,'$.entryMemberId'), e.id, n.user_id, 1 FROM json_each(?) j
        JOIN entry e ON e.id=json_extract(j.value,'$.entryId') JOIN notification n ON n.id=json_extract(j.value,'$.noticeId')
        WHERE ${accessOperationGuard}`, args: [source, ...guard] },
    { sql: "UPDATE event SET access_operation_token = NULL WHERE id = ? AND access_operation_token = ?", args: guard },
  ]);
  if (!changed) return null;
  const notices = await deliver(eventId, candidates.map(c => c.noticeId));
  const confirmed = notices.filter(n => n.type === "lottery_won").length;
  return { drawn: notices.length, confirmed, lost: notices.length - confirmed };
}

export async function setMemberSlotStatus(eventId: string, actorId: string, slotId: string, userId: string, status: string) {
  const token = crypto.randomUUID(), entryId = crypto.randomUUID(), noticeId = crypto.randomUUID(), now = Date.now(), guard = [eventId, token];
  const [changed] = await batch([
    { sql: `UPDATE event AS e SET access_operation_token=?,access_revision=access_revision+1 WHERE e.id=?
        AND ${activeManagerSql("e", "?")} AND EXISTS (SELECT 1 FROM user u JOIN event_member m ON m.user_id=u.id
          WHERE u.id=? AND u.deleted_at IS NULL AND m.event_id=e.id AND m.slot_id=? AND m.role='participant' AND m.status <> 'canceled'
            AND ${eventViewSql("e", "u.id", "?")})`, args: [token, eventId, actorId, adminIds(), userId, slotId, adminIds()] },
    { sql: `UPDATE event_member SET status=?,attended=CASE WHEN ?='confirmed' THEN attended ELSE 0 END,
        attended_at=CASE WHEN ?='confirmed' THEN attended_at ELSE NULL END WHERE event_id=? AND user_id=? AND ${accessOperationGuard}`,
      args: [status, status, status, eventId, userId, ...guard] },
    { sql: `DELETE FROM entry WHERE event_id=? AND kind='individual' AND ? <> 'confirmed'
        AND id IN (SELECT entry_id FROM entry_member WHERE user_id=?) AND ${accessOperationGuard}`, args: [eventId, status, userId, ...guard] },
    { sql: `INSERT INTO entry(id,event_id,kind,name,created_at) SELECT ?,?,'individual',COALESCE(u.global_name,u.username),?
        FROM user u WHERE u.id=? AND ?='confirmed' AND ${accessOperationGuard}
        AND NOT EXISTS (SELECT 1 FROM entry e JOIN entry_member em ON em.entry_id=e.id WHERE e.event_id=? AND e.kind='individual' AND em.user_id=u.id)`,
      args: [entryId, eventId, now, userId, status, ...guard, eventId] },
    { sql: `INSERT INTO entry_member(id,entry_id,user_id,is_leader) SELECT ?,?,?,1 WHERE EXISTS (SELECT 1 FROM entry WHERE id=?) AND ${accessOperationGuard}`,
      args: [crypto.randomUUID(), entryId, userId, entryId, ...guard] },
    { sql: `INSERT INTO notification(id,user_id,type,title,body,link,created_at,event_id)
        SELECT ?,?,CASE WHEN ?='confirmed' THEN 'lottery_won' ELSE 'lottery_lost' END,
          CASE WHEN ?='confirmed' THEN '参加が確定しました' ELSE '抽選結果のお知らせ' END,
          CASE WHEN e.visibility <> 'public' THEN 'イベントの更新があります' WHEN ?='confirmed' THEN '「'||e.title||'」への参加が確定しました' ELSE '「'||e.title||'」は今回は落選となりました' END,
          ?,?,e.id FROM event e WHERE e.id=? AND ? IN ('confirmed','lost') AND ${accessOperationGuard}`,
      args: [noticeId, userId, status, status, status, `/events/${eventId}`, now, eventId, status, ...guard] },
    { sql: "UPDATE event SET access_operation_token=NULL WHERE id=? AND access_operation_token=?", args: guard },
  ]);
  if (changed) await deliver(eventId, [noticeId]);
  return Boolean(changed);
}
