import type { CutinAction, CutinStatus } from "@eventer/shared";
import { one } from "../client.js";
import { eventRun, eventWrite } from "./eventWriteGuard.js";

type Row = { cutin_action_id: string | null; cutin_message: string | null; cutin_issued_at: number | null; cutin_expires_at: number | null; ends_at: number };
const current = (eventId: string) => one<Row>(`SELECT s.cutin_action_id, s.cutin_message, s.cutin_issued_at, s.cutin_expires_at, e.ends_at
  FROM event_live_state s JOIN event e ON e.id=s.event_id WHERE s.event_id=?`, eventId);
const writer = (eventId: string, actorId: string) => ({ eventId, actorId, permission: "staff" as const });

export const eventLiveCutinRepo = {
  async get(eventId: string, actorId: string): Promise<CutinStatus> {
    const row = await current(eventId);
    const serverNow = Date.now();
    if (!row?.cutin_action_id || !row.cutin_message || row.cutin_issued_at === null || row.cutin_expires_at === null) return { action: null, serverNow };
    if (row.cutin_expires_at <= serverNow) {
      // An older GET must never clear a newer action. Recheck staff inside the batch.
      await eventRun(writer(eventId, actorId), `UPDATE event_live_state SET cutin_action_id=NULL, cutin_message=NULL,
        cutin_issued_at=NULL, cutin_expires_at=NULL WHERE event_id=? AND cutin_action_id=? AND cutin_expires_at<=?`, eventId, row.cutin_action_id, serverNow);
      return { action: null, serverNow };
    }
    if (row.ends_at <= serverNow) return { action: null, serverNow };
    return { action: { actionId: row.cutin_action_id, message: row.cutin_message, issuedAt: row.cutin_issued_at, expiresAt: row.cutin_expires_at }, serverNow };
  },
  async trigger(eventId: string, actorId: string, message: string): Promise<CutinAction | null> {
    const issuedAt = Date.now(), expiresAt = issuedAt + 8000, actionId = crypto.randomUUID();
    const [, changed] = await eventWrite(writer(eventId, actorId), [
      { sql: "INSERT OR IGNORE INTO event_live_state(event_id, updated_at) SELECT id, ? FROM event WHERE id=?", args: [issuedAt, eventId] },
      { sql: `UPDATE event_live_state SET cutin_action_id=?, cutin_message=?, cutin_issued_at=?, cutin_expires_at=?
        WHERE event_id=? AND EXISTS (SELECT 1 FROM event WHERE id=? AND ends_at>?)`, args: [actionId, message, issuedAt, expiresAt, eventId, eventId, issuedAt] },
    ]);
    return changed ? { actionId, message, issuedAt, expiresAt } : null;
  },
};
