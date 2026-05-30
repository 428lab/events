import type { EventMode, EventState } from "@eventer/shared";
import { db } from "../client.js";

interface StateRow {
  event_id: string;
  mode: string;
  presenting_entry_id: string | null;
  scoring_locked: number;
  awards_reveal_cursor: number | null;
  updated_at: number;
}

function toState(row: StateRow): EventState {
  return {
    eventId: row.event_id,
    mode: row.mode as EventMode,
    presentingEntryId: row.presenting_entry_id,
    scoringLocked: row.scoring_locked === 1,
    awardsRevealCursor: row.awards_reveal_cursor,
    updatedAt: row.updated_at,
  };
}

export const eventStateRepo = {
  /** 取得。無ければデフォルト(normal)を作成 */
  getOrInit(eventId: string): EventState {
    const row = db
      .prepare("SELECT * FROM event_state WHERE event_id = ?")
      .get(eventId) as StateRow | undefined;
    if (row) return toState(row);
    db.prepare(
      "INSERT INTO event_state (event_id, mode, scoring_locked, updated_at) VALUES (?, 'normal', 0, ?)",
    ).run(eventId, Date.now());
    return this.getOrInit(eventId);
  },

  setMode(eventId: string, mode: EventMode): EventState {
    this.getOrInit(eventId);
    db.prepare(
      "UPDATE event_state SET mode = ?, updated_at = ? WHERE event_id = ?",
    ).run(mode, Date.now(), eventId);
    return this.getOrInit(eventId);
  },

  setPresenting(eventId: string, presentingEntryId: string | null): EventState {
    this.getOrInit(eventId);
    db.prepare(
      "UPDATE event_state SET presenting_entry_id = ?, updated_at = ? WHERE event_id = ?",
    ).run(presentingEntryId, Date.now(), eventId);
    return this.getOrInit(eventId);
  },

  setScoringLocked(eventId: string, locked: boolean): EventState {
    this.getOrInit(eventId);
    db.prepare(
      "UPDATE event_state SET scoring_locked = ?, updated_at = ? WHERE event_id = ?",
    ).run(locked ? 1 : 0, Date.now(), eventId);
    return this.getOrInit(eventId);
  },
};
