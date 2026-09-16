import {eventWrite,type EventWriter} from "./eventWriteGuard.js";
import { one } from "../client.js";

/** 画像メタ情報（本体バイト列は R2 に保存する）。 */
export interface EventImageMeta {
  objectKey: string | null;
  mime: string;
  updatedAt: number;
}

interface ImageRow {
  object_key: string | null;
  mime: string;
  updated_at: number;
}

export const eventImagesRepo = {
  async getMeta(eventId: string): Promise<EventImageMeta | null> {
    const row = await one<ImageRow>(
      "SELECT object_key, mime, updated_at FROM event_image WHERE event_id = ?",
      eventId,
    );
    return row ? {objectKey:row.object_key, mime: row.mime, updatedAt: row.updated_at } : null;
  },

  /** メタ情報を upsert し、event.image_updated_at も更新。updatedAt を返す。 */
  async upsert(eventId: string, mime: string, objectKey:string, writer:EventWriter): Promise<number> {
    const now = Date.now();
    await eventWrite(writer,[
      {
        sql: `INSERT INTO event_image (event_id, mime, updated_at,object_key)
              VALUES (?, ?, ?,?)
              ON CONFLICT(event_id) DO UPDATE SET mime = excluded.mime,
                updated_at = excluded.updated_at, object_key=excluded.object_key`,
        args: [eventId, mime, now,objectKey],
      },
      {
        sql: "UPDATE event SET image_updated_at = ? WHERE id = ?",
        args: [now, eventId],
      },
    ]);
    return now;
  },

  async delete(eventId: string, writer:EventWriter): Promise<void> {
    await eventWrite(writer,[
      { sql: "DELETE FROM event_image WHERE event_id = ?", args: [eventId] },
      {
        sql: "UPDATE event SET image_updated_at = NULL WHERE id = ?",
        args: [eventId],
      },
    ]);
  },
};
