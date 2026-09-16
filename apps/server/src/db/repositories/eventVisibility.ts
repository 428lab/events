import type { Event } from "@eventer/shared";
import { accessOperationGuard } from "./eventAccessInvites.js";

/** Only the winning event CAS owns these effects. Visibility's PNG triggers run
 * in that same batch; memberships and seats themselves are not changed. */
export function visibilityChangeStatements(eventId:string,token:string,from:Event["visibility"],to:Event["visibility"]) {
  const args=[eventId,token], now=Date.now();
  return [
    ...(to === "private" && from !== "private" ? [
      {sql:`INSERT INTO event_access_invite(id,event_id,user_id,invited_by,status,source,created_at,responded_at)
        SELECT lower(hex(randomblob(16))),m.event_id,m.user_id,NULL,'accepted','existing_member',?,?
        FROM event_member m WHERE m.event_id=? AND m.status<>'canceled' AND ${accessOperationGuard}
        ON CONFLICT(event_id,user_id) DO NOTHING`, args:[now,now,eventId,...args]},
      {sql:`UPDATE event_pre_survey SET token=lower(hex(randomblob(16))),status='closed',closed_at=?
        WHERE event_id=? AND ${accessOperationGuard}`,args:[now,eventId,...args]},
    ]:[]),
    ...(from === "private" && to !== "private" ? [
      {sql:`DELETE FROM event_access_invite WHERE event_id=? AND ${accessOperationGuard}`,args:[eventId,...args]},
    ]:[]),
    {sql:`UPDATE event SET access_operation_token=NULL WHERE id=? AND access_operation_token=?`,args},
  ];
}
