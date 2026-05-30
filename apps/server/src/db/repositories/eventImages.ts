import { db } from "../client.js";

export interface EventImage {
  mime: string;
  data: Buffer;
  updatedAt: number;
}

interface ImageRow {
  mime: string;
  data: Buffer;
  updated_at: number;
}

export const eventImagesRepo = {
  get(eventId: string): EventImage | null {
    const row = db
      .prepare("SELECT mime, data, updated_at FROM event_image WHERE event_id = ?")
      .get(eventId) as ImageRow | undefined;
    if (!row) return null;
    return { mime: row.mime, data: row.data, updatedAt: row.updated_at };
  },

  upsert(eventId: string, mime: string, data: Buffer): number {
    const now = Date.now();
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO event_image (event_id, mime, data, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET mime = excluded.mime,
           data = excluded.data, updated_at = excluded.updated_at`,
      ).run(eventId, mime, data, now);
      db.prepare("UPDATE event SET image_updated_at = ? WHERE id = ?").run(
        now,
        eventId,
      );
    });
    tx();
    return now;
  },

  delete(eventId: string): void {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM event_image WHERE event_id = ?").run(eventId);
      db.prepare("UPDATE event SET image_updated_at = NULL WHERE id = ?").run(
        eventId,
      );
    });
    tx();
  },
};
