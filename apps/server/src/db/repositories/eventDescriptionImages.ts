import { EVENT_DESCRIPTION_IMAGE } from "@eventer/shared";
import { many, one } from "../client.js";
import { eventWrite, type EventWriter } from "./eventWriteGuard.js";

/** 説明文画像の1行（R2 キーは id から組み立てる。mediaCleanup.ts の
 * eventDescriptionImageR2Key） */
export interface EventDescriptionImageRow {
  id: string;
  eventId: string;
  mime: string;
  size: number;
  createdAt: number;
}

interface Row {
  id: string;
  event_id: string;
  mime: string;
  size: number;
  created_at: number;
}

const toRow = (r: Row): EventDescriptionImageRow => ({
  id: r.id,
  eventId: r.event_id,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
});

export const eventDescriptionImagesRepo = {
  async listByEvent(eventId: string): Promise<EventDescriptionImageRow[]> {
    const rows = await many<Row>(
      "SELECT id, event_id, mime, size, created_at FROM event_description_image WHERE event_id = ? ORDER BY created_at, id",
      eventId,
    );
    return rows.map(toRow);
  },

  async find(eventId: string, id: string): Promise<EventDescriptionImageRow | null> {
    const row = await one<Row>(
      "SELECT id, event_id, mime, size, created_at FROM event_description_image WHERE id = ? AND event_id = ?",
      id,
      eventId,
    );
    return row ? toRow(row) : null;
  },

  /** 上限（1イベント10枚）を**1文の条件付き INSERT** で守る。同時に送られても
   * 数えてから入れるまでの間に割り込まれない。入らなければ false */
  async insertWithinLimit(row: EventDescriptionImageRow, writer: EventWriter): Promise<boolean> {
    const [changes] = await eventWrite(writer, [
      {
        sql: `INSERT INTO event_description_image (id, event_id, mime, size, created_at)
              SELECT ?, ?, ?, ?, ?
              WHERE (SELECT COUNT(*) FROM event_description_image WHERE event_id = ?) < ?`,
        args: [
          row.id,
          row.eventId,
          row.mime,
          row.size,
          row.createdAt,
          row.eventId,
          EVENT_DESCRIPTION_IMAGE.maxPerEvent,
        ],
      },
    ]);
    return (changes ?? 0) > 0;
  },

  async delete(eventId: string, id: string, writer: EventWriter): Promise<boolean> {
    const [changes] = await eventWrite(writer, [
      {
        sql: "DELETE FROM event_description_image WHERE id = ? AND event_id = ?",
        args: [id, eventId],
      },
    ]);
    return (changes ?? 0) > 0;
  },
};
