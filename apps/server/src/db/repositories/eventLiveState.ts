import { eventRun, type EventWriter } from "./eventWriteGuard.js";
import type { EventLiveState, UpdateEventLiveStateInput } from "@eventer/shared";
import { many, one, run } from "../client.js";
import { selectPresenterAssignments } from "./presenterSlides.js";

interface Row {
  event_id: string;
  live_set_id: string | null;
  active_scene_id: string | null;
  deck_id: string | null;
  deck_page: number;
  bgm_track_id: string | null;
  bgm_playing: number;
  bgm_volume: number;
  live_indicator_on: number;
  chat_source: "off" | "event";
  presenter_item_id: string | null;
  updated_at: number;
}

function toState(row: Row): EventLiveState {
  return {
    eventId: row.event_id,
    liveSetId: row.live_set_id,
    activeSceneId: row.active_scene_id,
    deckId: row.deck_id,
    deckPage: row.deck_page,
    bgmTrackId: row.bgm_track_id,
    bgmPlaying: row.bgm_playing === 1,
    bgmVolume: row.bgm_volume,
    liveIndicatorOn: row.live_indicator_on === 1,
    chatSource: row.chat_source,
    presenterItemId: row.presenter_item_id,
    updatedAt: row.updated_at,
  };
}

export const eventLiveStateRepo = {
  /** Events whose live state shows this deck or live set. Read before deleting one, because
   * ON DELETE SET NULL changes those rows without the event id in hand (refetch signal `live`). */
  async eventIdsUsing(column: "deck_id" | "live_set_id", id: string): Promise<string[]> {
    const rows = await many<{ event_id: string }>(`SELECT event_id FROM event_live_state WHERE ${column} = ?`, id);
    return rows.map((row) => row.event_id);
  },

  async getOrInit(eventId: string): Promise<EventLiveState> {
    const row = await one<Row>(
      "SELECT * FROM event_live_state WHERE event_id = ?",
      eventId,
    );
    if (row) return toState(row);
    await run(
      `INSERT OR IGNORE INTO event_live_state (event_id, updated_at) VALUES (?, ?)`,
      eventId,
      Date.now(),
    );
    return (await this.getOrInit(eventId))!;
  },

  async update(
    eventId: string,
    input: UpdateEventLiveStateInput, writer: EventWriter): Promise<EventLiveState> {
    await this.getOrInit(eventId);
    const { presenterItemId, ...plain } = input;
    const columns: Record<keyof typeof plain, string> = {
      liveSetId: "live_set_id", activeSceneId: "active_scene_id", deckId: "deck_id",
      deckPage: "deck_page", bgmTrackId: "bgm_track_id", bgmPlaying: "bgm_playing",
      bgmVolume: "bgm_volume", liveIndicatorOn: "live_indicator_on", chatSource: "chat_source",
    };
    const fields = Object.entries(plain).filter(([, value]) => value !== undefined);
    const assignments = fields.map(([key]) => `${columns[key as keyof typeof plain]} = ?`);
    const args: unknown[] = fields.map(([, value]) => typeof value === "boolean" ? Number(value) : value);
    // 発表者を選ぶ (#571): デッキとページはサーバーが決める（ルートが deckId / deckPage との同時指定を弾く）
    if (presenterItemId !== undefined) {
      const presenter = selectPresenterAssignments(eventId, presenterItemId);
      assignments.push(presenter.sql);
      args.push(...presenter.args);
    } else if (plain.deckId !== undefined) {
      // デッキを直接選んだ（「その他のスライド」）ら発表者の選択は外れる
      assignments.push("presenter_item_id = NULL");
    }
    if (assignments.length) {
      await eventRun(input.liveIndicatorOn !== undefined || input.chatSource !== undefined ? { ...writer, permission: "staff" } : writer,
        `UPDATE event_live_state SET ${assignments.join(", ")}, updated_at = ? WHERE event_id = ?`,
        ...args, Date.now(), eventId,
      );
    }
    return this.getOrInit(eventId);
  },
};
