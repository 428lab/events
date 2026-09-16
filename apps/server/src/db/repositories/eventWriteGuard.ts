import { eventManagerSql, eventViewSql } from "../../auth/eventAccess.js";
import { adminIds } from "./eventAccessInvites.js";
import { batch } from "../client.js";
import { HTTPException } from "hono/http-exception";

type Statement = {sql:string;args?:unknown[]};
export type EventWriter = {eventId:string;actorId:string;permission:"view"|"manager"|"staff"|"judge"|"member"|"chat-member"|"chat-staff"|"registered"|"scorer"};
/** Assertion runs IN the existing D1 batch: denial aborts all following writes.
 * The literal invalid JSON path identifies this assertion, not other SQL errors.
 * Child ownership, target qualification, capacity and CAS remain writer concerns. */
export function eventWriteGuard({eventId,actorId,permission}: EventWriter): Statement {
  const role = permission === "view" ? "1" : permission === "manager"
    ? eventManagerSql("e","u","?1")
    : `EXISTS(SELECT 1 FROM event_member m WHERE m.event_id=e.id AND m.user_id=u.id AND m.status${permission === "registered" || permission === "scorer" ? "<>'canceled'" : "='confirmed'"} AND m.role IN (${permission === "staff" || permission === "chat-staff" ? "'staff'" : permission === "judge" ? "'judge','staff'" : permission === "scorer" ? "'participant','judge','staff'" : "'staff','participant','observer','judge'"}))`;
  return {sql:`SELECT CASE WHEN EXISTS(SELECT 1 FROM event e JOIN user u ON u.id=?2 AND u.deleted_at IS NULL
    WHERE e.id=?3 AND ${eventViewSql("e","u.id","?1")} AND (${role} ${permission === "member" || permission === "registered" || permission === "judge" || permission === "scorer" || permission === "chat-member" ? `OR ${eventManagerSql("e","u","?1")}` : ""})
    ${permission.startsWith("chat-") ? "AND e.visibility='public'" : ""}) THEN 1
    ELSE json_extract('{}','event_access_changed') END`,args:[adminIds(),actorId,eventId]};
}
export async function eventWrite(writer:EventWriter, statements:Statement[]):Promise<number[]> {
  try { return (await batch([eventWriteGuard(writer),...statements])).slice(1); }
  catch(error) {
    if (String(error).includes("event_access_changed") || String((error as Error).cause).includes("event_access_changed"))
      throw new HTTPException(409,{res:Response.json({error:"access_changed"},{status:409})});
    throw error;
  }
}
export async function eventRun(writer:EventWriter,sql:string,...args:unknown[]):Promise<number> {
  return (await eventWrite(writer,[{sql,args}]))[0] ?? 0;
}
