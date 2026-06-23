import type { EventMode, EventState } from "@eventer/shared";
import { one, run } from "../client.js";

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
  async getOrInit(eventId: string): Promise<EventState> {
    const row = await one<StateRow>(
      "SELECT * FROM event_state WHERE event_id = ?",
      eventId,
    );
    if (row) return toState(row);
    await run(
      "INSERT INTO event_state (event_id, mode, scoring_locked, updated_at) VALUES (?, 'normal', 0, ?)",
      eventId,
      Date.now(),
    );
    return this.getOrInit(eventId);
  },

  async setMode(eventId: string, mode: EventMode): Promise<EventState> {
    await this.getOrInit(eventId);
    await run(
      "UPDATE event_state SET mode = ?, updated_at = ? WHERE event_id = ?",
      mode,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },

  async setPresenting(
    eventId: string,
    presentingEntryId: string | null,
  ): Promise<EventState> {
    await this.getOrInit(eventId);
    await run(
      "UPDATE event_state SET presenting_entry_id = ?, updated_at = ? WHERE event_id = ?",
      presentingEntryId,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },

  async setScoringLocked(
    eventId: string,
    locked: boolean,
  ): Promise<EventState> {
    await this.getOrInit(eventId);
    await run(
      "UPDATE event_state SET scoring_locked = ?, updated_at = ? WHERE event_id = ?",
      locked ? 1 : 0,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },

  async setAwardsCursor(
    eventId: string,
    cursor: number | null,
  ): Promise<EventState> {
    await this.getOrInit(eventId);
    await run(
      "UPDATE event_state SET awards_reveal_cursor = ?, updated_at = ? WHERE event_id = ?",
      cursor,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },
};
