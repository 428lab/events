import { eventManagerSql, eventViewSql } from "../../auth/eventAccess.js";
import { one } from "../client.js";
import { adminIds } from "./eventAccessInvites.js";

export const publicNoticeTypes = "'followee_created_event','followee_joined_event','request_event_created'";
/** The same qualification is used for pages, counts and delivery. Invitation
 * receipts are not viewing grants. Unresolved legacy rows are not guessed. */
export function notificationVisibleSql(n = "notification"): string {
  return `(${n}.event_id IS NULL OR EXISTS (SELECT 1 FROM event e JOIN user recipient
    ON recipient.id=${n}.user_id AND recipient.deleted_at IS NULL WHERE e.id=${n}.event_id AND (
    ${n}.type='event_access_invite'
    OR (${n}.type='staff_invite' AND EXISTS (SELECT 1 FROM event_staff_invite i JOIN user inviter
      ON inviter.id=i.invited_by AND inviter.deleted_at IS NULL WHERE i.event_id=e.id AND i.user_id=recipient.id
      AND i.status='pending' AND ${eventManagerSql("e", "inviter", "?1")}))
    OR (${n}.type NOT IN ('event_access_invite','staff_invite') AND ${eventViewSql("e", "recipient.id", "?1")}
      AND (e.visibility='public' OR ${eventManagerSql("e", "recipient", "?1")}
        OR EXISTS(SELECT 1 FROM event_member m WHERE m.event_id=e.id AND m.user_id=recipient.id AND m.status<>'canceled')
        OR EXISTS(SELECT 1 FROM event_access_invite i WHERE i.event_id=e.id AND i.user_id=recipient.id AND i.status='accepted'))
      AND (${n}.type<>'staff_invite_result' OR ${eventManagerSql("e", "recipient", "?1")})
      AND (${n}.actor_id IS NULL OR EXISTS(SELECT 1 FROM user actor WHERE actor.id=${n}.actor_id AND actor.deleted_at IS NULL))
      AND (${n}.type NOT IN (${publicNoticeTypes}) OR (e.visibility='public' AND e.status='published'))
      AND (${n}.actor_id IS NULL OR (${n}.type NOT IN ('meet','event_broadcast',${publicNoticeTypes})) OR EXISTS (
        SELECT 1 FROM user actor WHERE actor.id=${n}.actor_id AND actor.deleted_at IS NULL
        AND ${eventViewSql("e", "actor.id", "?1")}
        AND (${n}.type<>'event_broadcast' OR ${eventManagerSql("e", "actor", "?1")})))
    )) ))`;
}
export function eventIdFromNotificationLink(link: string): string | undefined {
  return /^\/events\/([0-9a-f-]{36})(?:[/?#]|$)/.exec(link)?.[1];
}
export async function notificationDeliveryEvent(userId: string, eventId: string, type: string, actorId?: string) {
  return one<{ visibility: string }>(`WITH notice AS (SELECT ?2 user_id,?3 event_id,?4 type,?5 actor_id)
    SELECT e.visibility FROM notice JOIN event e ON e.id=notice.event_id WHERE ${notificationVisibleSql("notice")}`,
    adminIds(), userId,eventId,type,actorId??null);
}
export function genericEventNotice(eventId: string, type: string) {
  return { title: "イベントの更新があります", body: "", link: type === "staff_invite" ? "/staff-invites" : type === "event_access_invite" ? "/event-invites" : `/events/${eventId}` };
}
