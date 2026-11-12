import { eventRun, type EventWriter } from "./eventWriteGuard.js";
import type { EventMode, EventState } from "@eventer/shared";
import { one, run } from "../client.js";
import { generateChatKey } from "../../lib/nostrSign.js";

interface StateRow {
  event_id: string;
  mode: string;
  presenting_entry_id: string | null;
  scoring_locked: number;
  scoring_started: number;
  awards_reveal_cursor: number | null;
  updated_at: number;
  present_deck_slug: string | null;
  present_control: string;
  present_control_version: number;
  present_control_secret: string | null;
}

/** ページめくりの世代（docs/contest-organizer-ux.md「発表のページめくり」）。
 * 秘密鍵はここから外へは、めくれる人を確かめたルートだけが出す */
export interface PresentControlRow {
  deckSlug: string | null;
  control: "staff" | "presenter";
  version: number;
  secret: string | null;
}

function toState(row: StateRow): EventState {
  return {
    eventId: row.event_id,
    mode: row.mode as EventMode,
    presentingEntryId: row.presenting_entry_id,
    scoringStarted: row.scoring_started === 1,
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

  async setMode(eventId: string, mode: EventMode, writer: EventWriter): Promise<EventState> {
    await this.getOrInit(eventId);
    await eventRun(writer,
      "UPDATE event_state SET mode = ?, updated_at = ? WHERE event_id = ?",
      mode,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },

  async setPresenting(
    eventId: string,
    presentingEntryId: string | null, writer: EventWriter): Promise<EventState> {
    await this.getOrInit(eventId);
    await eventRun(writer,
      // 発表が変わったら、選んだスライドとページめくりを運営に戻し、鍵を作り直す
      // （前の発表者の画面からはもうめくれない）。同じエントリーを選び直しただけなら触らない
      `UPDATE event_state SET
         present_deck_slug = CASE WHEN presenting_entry_id IS ? THEN present_deck_slug ELSE NULL END,
         present_control = CASE WHEN presenting_entry_id IS ? THEN present_control ELSE 'staff' END,
         present_control_secret = CASE WHEN presenting_entry_id IS ? THEN present_control_secret ELSE ? END,
         present_control_version = present_control_version + CASE WHEN presenting_entry_id IS ? THEN 0 ELSE 1 END,
         presenting_entry_id = ?, updated_at = ?
       WHERE event_id = ?`,
      presentingEntryId, presentingEntryId, presentingEntryId, generateChatKey().secret, presentingEntryId,
      presentingEntryId,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },

  /** ページめくりの今の世代。鍵がまだ無ければ作る（初めて読んだとき） */
  async presentControl(eventId: string): Promise<PresentControlRow> {
    await this.getOrInit(eventId);
    await run(
      "UPDATE event_state SET present_control_secret = ? WHERE event_id = ? AND present_control_secret IS NULL",
      generateChatKey().secret,
      eventId,
    );
    const row = (await one<StateRow>("SELECT * FROM event_state WHERE event_id = ?", eventId))!;
    return {
      deckSlug: row.present_deck_slug,
      control: row.present_control === "presenter" ? "presenter" : "staff",
      version: row.present_control_version,
      secret: row.present_control_secret,
    };
  },

  /** 運営の操作: ページめくりを渡す／戻す、スライドを選ぶ。どれでも世代を進めて鍵を作り直す */
  async setPresentControl(
    eventId: string,
    patch: { control?: "staff" | "presenter"; deckSlug?: string | null },
    writer: EventWriter,
  ): Promise<void> {
    await this.getOrInit(eventId);
    await eventRun(writer,
      `UPDATE event_state SET
         present_control = COALESCE(?, present_control),
         present_deck_slug = CASE WHEN ? THEN ? ELSE present_deck_slug END,
         present_control_secret = ?,
         present_control_version = present_control_version + 1,
         updated_at = ?
       WHERE event_id = ?`,
      patch.control ?? null,
      patch.deckSlug !== undefined ? 1 : 0,
      patch.deckSlug ?? null,
      generateChatKey().secret,
      Date.now(),
      eventId,
    );
  },

  async setScoringLocked(
    eventId: string,
    locked: boolean, writer: EventWriter): Promise<EventState> {
    await this.getOrInit(eventId);
    await eventRun(writer,
      "UPDATE event_state SET scoring_locked = ?, updated_at = ? WHERE event_id = ?",
      locked ? 1 : 0,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },

  /** 採点を開始する（受付中にする）。締切は触らない */
  async startScoring(eventId: string, writer: EventWriter): Promise<EventState> {
    await this.getOrInit(eventId);
    await eventRun(writer,
      "UPDATE event_state SET scoring_started = 1, updated_at = ? WHERE event_id = ?",
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },

  async setAwardsCursor(
    eventId: string,
    cursor: number | null, writer: EventWriter): Promise<EventState> {
    await this.getOrInit(eventId);
    await eventRun(writer,
      "UPDATE event_state SET awards_reveal_cursor = ?, updated_at = ? WHERE event_id = ?",
      cursor,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },
};
