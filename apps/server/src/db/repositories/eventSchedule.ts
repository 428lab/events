import type { SaveScheduleItemInput, ScheduleItem } from "@eventer/shared";
import { batch, many } from "../client.js";

interface Row {
  id: string;
  event_id: string;
  title: string;
  description: string;
  duration_min: number;
  starts_at: number | null;
  speaker_user_id: string | null;
  speaker_name: string;
  material_url: string;
  sort_order: number;
  u_username: string | null;
  u_global_name: string | null;
  u_avatar_url: string | null;
}

function toItem(row: Row): ScheduleItem {
  return {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    description: row.description,
    durationMin: row.duration_min,
    startsAt: row.starts_at,
    // JOIN できた場合のみ担当者をユーザー情報として返す（削除済み等は null）
    speaker:
      row.speaker_user_id && row.u_username
        ? {
            id: row.speaker_user_id,
            username: row.u_username,
            globalName: row.u_global_name,
            avatarUrl: row.u_avatar_url,
          }
        : null,
    speakerName: row.speaker_name,
    materialUrl: row.material_url,
    sortOrder: row.sort_order,
  };
}

const SELECT = `SELECT s.id, s.event_id, s.title, s.description, s.duration_min,
  s.starts_at, s.speaker_user_id, s.speaker_name, s.material_url, s.sort_order,
  u.username AS u_username, u.global_name AS u_global_name,
  u.avatar_url AS u_avatar_url
  FROM event_schedule_item s LEFT JOIN user u ON u.id = s.speaker_user_id`;

export const eventScheduleRepo = {
  async listByEvent(eventId: string): Promise<ScheduleItem[]> {
    const rows = await many<Row>(
      `${SELECT} WHERE s.event_id = ? ORDER BY s.sort_order ASC`,
      eventId,
    );
    return rows.map(toItem);
  },

  /** 全項目をアトミックに置き換える（削除＋一括挿入）。並び順は配列順。 */
  async replaceAll(
    eventId: string,
    items: SaveScheduleItemInput[],
  ): Promise<ScheduleItem[]> {
    const now = Date.now();
    await batch([
      {
        sql: "DELETE FROM event_schedule_item WHERE event_id = ?",
        args: [eventId],
      },
      ...items.map((it, i) => ({
        sql: `INSERT INTO event_schedule_item
          (id, event_id, title, description, duration_min, starts_at,
           speaker_user_id, speaker_name, material_url, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          eventId,
          it.title,
          it.description,
          it.durationMin,
          it.startsAt,
          it.speakerUserId,
          it.speakerName,
          it.materialUrl,
          i,
          now,
        ],
      })),
    ]);
    return this.listByEvent(eventId);
  },
};
