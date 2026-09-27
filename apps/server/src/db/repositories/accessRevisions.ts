import { adminIds } from "./eventAccessInvites.js";

/** Capture account-related events BEFORE deleting/transferring its rows. This
 * revision invalidates stale access confirmations; it is not PNG invalidation.
 * A global administrator's qualifications affect every event. */
export function accountAccessRevision(userIds: readonly string[]) {
  return {
    sql: `UPDATE event AS e SET access_revision = access_revision + 1
      WHERE EXISTS (SELECT 1 FROM user u WHERE u.id IN (SELECT value FROM json_each(?)) AND (
        u.discord_id IN (SELECT value FROM json_each(?))
        OR EXISTS (SELECT 1 FROM event_member m WHERE m.event_id = e.id AND m.user_id = u.id)
        OR EXISTS (SELECT 1 FROM event_access_invite i WHERE i.event_id = e.id AND (i.user_id = u.id OR i.invited_by = u.id))
        OR EXISTS (SELECT 1 FROM community_member cm WHERE cm.community_id = e.community_id AND cm.user_id = u.id)))`,
    args: [JSON.stringify(userIds), adminIds()],
  };
}
