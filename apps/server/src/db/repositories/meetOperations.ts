import type { MeetScanEventResult } from "@eventer/shared";
import type { MeetUndoPayload } from "../../lib/meetToken.js";
import { getDb, many } from "../client.js";
import { eventPairViewSql } from "../../auth/eventAccess.js";
import { adminIds } from "./eventAccessInvites.js";
import { MEET_WINDOW_BEFORE_MS, MEET_WINDOW_AFTER_MS } from "./eventMeets.js";
import { notificationsRepo } from "./notifications.js";

/** Every statement re-evaluates the same current qualifications in ONE batch.
 * Candidate IDs/grant flags are data, never permission. */
function eligible(scan: boolean) {
  return `WITH input AS (SELECT ? scanner,? target,? admins,? candidates,? now), eligible AS (
    SELECT e.id,e.title,e.visibility,e.starts_at,e.attendance_check,mv.role scanner_role,mt.role target_role,
      json_extract(j.value,'$.meetId') meet_id,json_extract(j.value,'$.noticeId') notice_id,
      json_extract(j.value,'$.meetCreated') remove_meet,json_extract(j.value,'$.attendedMe') remove_me,
      json_extract(j.value,'$.attendedTarget') remove_target
    FROM input i,json_each(i.candidates) j JOIN event e ON e.id=json_extract(j.value,'$.eventId')
    JOIN event_member mv ON mv.event_id=e.id AND mv.user_id=i.scanner AND mv.status='confirmed'
    JOIN event_member mt ON mt.event_id=e.id AND mt.user_id=i.target AND mt.status='confirmed'
    WHERE ${eventPairViewSql("e", "i.scanner", "i.target", "i.admins")}
      ${scan ? `AND e.status='published' AND e.scheduling=0 AND e.starts_at>0 AND e.ends_at>0
        AND i.now>=e.starts_at-${MEET_WINDOW_BEFORE_MS} AND i.now<=e.ends_at+${MEET_WINDOW_AFTER_MS}` : ""}
  )`;
}
const attendanceChoice = `SELECT e.id FROM eligible e,input i ORDER BY (e.starts_at<=i.now) DESC,
  CASE WHEN e.starts_at<=i.now THEN -e.starts_at ELSE e.starts_at END ASC,e.id LIMIT 1`;

export async function visibleMeetResults(scanner: string, target: string, events: MeetScanEventResult[]) {
  if (!events.length) return [];
  const rows=await many<{id:string}>(`WITH input AS (SELECT ? scanner,? target,? admins)
    SELECT e.id FROM event e,input i WHERE e.id IN (SELECT value FROM json_each(?))
      AND ${eventPairViewSql("e", "i.scanner", "i.target", "i.admins")}`,
    scanner,target,adminIds(),JSON.stringify(events.map(e=>e.eventId)));
  const ids=new Set(rows.map(r=>r.id));return events.filter(e=>ids.has(e.eventId));
}

export async function scanMeetBatch(scanner: string,target: string,eventIds: string[],now: number,actorPath: string) {
  const candidates=eventIds.map(eventId=>({eventId,meetId:crypto.randomUUID(),noticeId:crypto.randomUUID()}));
  const args=[scanner,target,adminIds(),JSON.stringify(candidates),now], cte=eligible(true), db=getDb();
  const statements=[
    `${cte} INSERT INTO event_meet(id,event_id,user_low,user_high,created_at)
      SELECT e.meet_id,e.id,min(i.scanner,i.target),max(i.scanner,i.target),i.now FROM eligible e,input i WHERE 1
      ON CONFLICT(event_id,user_low,user_high) DO NOTHING RETURNING event_id`,
    ...[true,false].map(me=>`${cte} UPDATE event_member SET attended=1,attended_at=(SELECT now FROM input)
      WHERE user_id=(SELECT ${me?"scanner":"target"} FROM input) AND attended=0
        AND event_id IN (SELECT id FROM eligible WHERE attendance_check=1 AND ${me?"target_role":"scanner_role"}='staff'
          AND id=(${attendanceChoice})) RETURNING event_id`),
    `${cte} INSERT INTO notification(id,user_id,type,title,body,link,read_at,created_at,event_id,actor_id)
      SELECT e.notice_id,i.target,'meet',CASE WHEN e.visibility='public' THEN
        (SELECT COALESCE(global_name,username) FROM user WHERE id=i.scanner)||' さんと出会いました' ELSE '出会いを記録しました' END,
        CASE WHEN e.visibility<>'public' THEN 'イベントページで最新の情報をご確認ください'
          WHEN e.attendance_check=1 AND e.scanner_role='staff' AND e.id=(${attendanceChoice})
            AND EXISTS(SELECT 1 FROM event_member m WHERE m.event_id=e.id AND m.user_id=i.target AND m.attended_at=i.now)
          THEN '「'||e.title||'」の受付もこれで完了しています' ELSE '「'||e.title||'」' END,
        CASE WHEN e.visibility='public' THEN ? ELSE '/events/'||e.id END,0,i.now,e.id,i.scanner
      FROM eligible e,input i WHERE EXISTS(SELECT 1 FROM event_meet m WHERE m.id=e.meet_id)`,
    `${cte} SELECT id,title FROM eligible ORDER BY starts_at,id`,
  ];
  const results=await db.batch(statements.map((sql,index)=>db.prepare(sql).bind(...args,...(index===3?[actorPath]:[]))));
  const changed=(index:number)=>new Set((results[index]!.results as {event_id:string}[]).map(r=>r.event_id));
  const created=changed(0),mine=changed(1),theirs=changed(2);
  const events=(results[4]!.results as {id:string;title:string}[]).map(e=>({eventId:e.id,title:e.title,meetCreated:created.has(e.id),attendedMe:mine.has(e.id),attendedTarget:theirs.has(e.id)}));
  const wrote=created.size+mine.size+theirs.size>0;
  // Only transaction-created notifications are delivered, never the initial pairs.
  try { await notificationsRepo.deliverMeetNotifications(candidates.map(c=>c.noticeId)); }
  catch (error) { console.error("meet notification delivery failed",error); }
  return {events,wrote};
}

export async function undoMeetBatch(scanner: string,target: string,grants: MeetUndoPayload['grants'],since:number) {
  const token=crypto.randomUUID(),args=[scanner,target,adminIds(),JSON.stringify(grants),Date.now()];
  const cte=eligible(false),owned=`id IN (SELECT id FROM event WHERE access_operation_token=?)`,db=getDb();
  const stmts=[
    {sql:`${cte} UPDATE event SET access_operation_token=? WHERE id IN (SELECT e.id FROM eligible e,input i
      WHERE e.remove_meet=1 AND EXISTS(SELECT 1 FROM event_meet m WHERE m.event_id=e.id AND m.user_low=min(i.scanner,i.target) AND m.user_high=max(i.scanner,i.target)))`,args:[...args,token]},
    {sql:`DELETE FROM event_meet WHERE event_id IN(SELECT id FROM event WHERE access_operation_token=?)
      AND user_low=min(?,?) AND user_high=max(?,?) RETURNING event_id`,args:[token,scanner,target,scanner,target]},
    ...[true,false].map(me=>({sql:`${cte} UPDATE event_member SET attended=0,attended_at=NULL
      WHERE user_id=(SELECT ${me?'scanner':'target'} FROM input) AND attended=1
        AND event_id IN(SELECT id FROM eligible WHERE ${owned} AND ${me?'remove_me':'remove_target'}=1
          AND ${me?'target_role':'scanner_role'}='staff') RETURNING event_id`,args:[...args,token]})),
    {sql:`DELETE FROM notification WHERE type='meet' AND user_id=? AND actor_id=? AND created_at>=?
      AND event_id IN(SELECT id FROM event WHERE access_operation_token=?)`,args:[target,scanner,since,token]},
    {sql:'UPDATE event SET access_operation_token=NULL WHERE access_operation_token=?',args:[token]},
  ];
  const result=await db.batch(stmts.map(s=>db.prepare(s.sql).bind(...s.args)));
  const mine=new Set((result[2]!.results as {event_id:string}[]).map(r=>r.event_id));
  const theirs=new Set((result[3]!.results as {event_id:string}[]).map(r=>r.event_id));
  const changes=(result[1]!.results as {event_id:string}[]).map(r=>({eventId:r.event_id,title:'',meetCreated:true,attendedMe:mine.has(r.event_id),attendedTarget:theirs.has(r.event_id)}));
  const visible=await visibleMeetResults(scanner,target,changes);
  return {undone:visible.length,attendanceRevoked:visible.some(e=>e.attendedMe||e.attendedTarget)};
}
