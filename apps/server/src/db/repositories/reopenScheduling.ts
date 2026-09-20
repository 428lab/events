import { eventViewSql } from "../../auth/eventAccess.js";
import { activeManagerSql, adminIds } from "./eventAccessInvites.js";
import { batch, one } from "../client.js";
import type { ReopenSchedulingInput } from "@eventer/shared";

export const reopenSchedulingRepo = {
  async reopen(eventId: string, actorId: string, input: ReopenSchedulingInput) {
    const token = crypto.randomUUID();
    const ready = `e.id=? AND e.access_revision=? AND e.scheduling=0
      AND (e.registration_deadline IS NULL OR ?=1) AND ${activeManagerSql("e", "?")}`;
    const args = [eventId, input.expectedAccessRevision, input.clearRegistrationDeadline ? 1 : 0, actorId, adminIds()];
    // Notices and deadline clearing commit together. The request prefix identifies
    // exactly this batch for best-effort email, even across rapid schedule cycles.
    const [, changed] = await batch([
      { sql: `INSERT INTO notification(id,user_id,type,title,body,link,read_at,created_at,event_id)
        SELECT ? || u.id,u.id,'info','日程調整を再開しました',
          CASE WHEN e.visibility<>'public' THEN 'イベントの更新があります'
          ELSE '「' || e.title || '」の日程が未定になりました。候補日への回答をご確認ください。参加登録は維持されています。' END,
          ?,0,?,e.id
        FROM event e JOIN user u ON u.deleted_at IS NULL AND u.id<>?
        WHERE ${ready} AND u.id IN (
          SELECT v.user_id FROM event_date_vote v JOIN event_date_option o ON o.id=v.option_id WHERE o.event_id=e.id
          UNION SELECT m.user_id FROM event_member m WHERE m.event_id=e.id AND m.status<>'canceled')
          AND ${eventViewSql("e", "u.id", "?")}`,
        args: [token, `/events/${eventId}`, Date.now(), actorId, ...args, adminIds()] },
      { sql: `UPDATE event AS e SET scheduling=1,registration_deadline=NULL,access_revision=access_revision+1 WHERE ${ready}`, args },
    ]);
    if (changed) return { token, error: null };
    const current = await one<{ scheduling: number; access_revision: number; registration_deadline: number | null }>(
      `SELECT e.scheduling,e.access_revision,e.registration_deadline FROM event e WHERE e.id=? AND ${activeManagerSql("e", "?")}`,
      eventId, actorId, adminIds());
    if (current?.scheduling && [input.expectedAccessRevision, input.expectedAccessRevision + 1].includes(current.access_revision)) {
      return { token: null, error: null };
    }
    return { token: null, error: current?.access_revision === input.expectedAccessRevision && current.registration_deadline !== null && !input.clearRegistrationDeadline
      ? "deadline_clear_confirmation_required" : "schedule_changed" };
  },
};
