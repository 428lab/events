import type { EventLiveState, UpdateEventLiveStateInput } from "@eventer/shared";
import { one, run } from "../client.js";

interface Row {
  event_id: string;
  live_set_id: string | null;
  active_scene_id: string | null;
  deck_id: string | null;
  deck_page: number;
  bgm_track_id: string | null;
  bgm_playing: number;
  bgm_volume: number;
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
    updatedAt: row.updated_at,
  };
}

export const eventLiveStateRepo = {
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
    input: UpdateEventLiveStateInput,
  ): Promise<EventLiveState> {
    const cur = await this.getOrInit(eventId);
    const next = { ...cur, ...input };
    await run(
      `UPDATE event_live_state SET
         live_set_id = ?, active_scene_id = ?, deck_id = ?, deck_page = ?,
         bgm_track_id = ?, bgm_playing = ?, bgm_volume = ?, updated_at = ?
       WHERE event_id = ?`,
      next.liveSetId ?? null,
      next.activeSceneId ?? null,
      next.deckId ?? null,
      next.deckPage,
      next.bgmTrackId ?? null,
      next.bgmPlaying ? 1 : 0,
      next.bgmVolume,
      Date.now(),
      eventId,
    );
    return this.getOrInit(eventId);
  },
};
