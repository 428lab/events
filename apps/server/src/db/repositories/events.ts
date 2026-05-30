import type {
  CreateEventInput,
  Event,
  UpdateEventInput,
} from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";

interface EventRow {
  id: string;
  title: string;
  description: string;
  starts_at: number;
  ends_at: number;
  venue_type: string;
  venue_offline: string | null;
  venue_online: string | null;
  participation_type: string;
  aggregate_self_entry: number;
  status: string;
  created_by: string;
  created_at: number;
  image_updated_at: number | null;
  participant_count: number;
}

/** participant_count（参加メンバー総数）を含む event の SELECT */
const SELECT_EVENT = `SELECT *,
  (SELECT COUNT(1) FROM event_member em
   WHERE em.event_id = event.id) AS participant_count
  FROM event`;

function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    venueType: row.venue_type as Event["venueType"],
    venueOffline: row.venue_offline,
    venueOnline: row.venue_online,
    participationType: row.participation_type as Event["participationType"],
    aggregateSelfEntry: row.aggregate_self_entry === 1,
    status: row.status as Event["status"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    imageUpdatedAt: row.image_updated_at,
    participantCount: row.participant_count,
  };
}

export const eventsRepo = {
  findById(id: string): Event | null {
    const row = db.prepare(`${SELECT_EVENT} WHERE id = ?`).get(id) as
      | EventRow
      | undefined;
    return row ? toEvent(row) : null;
  },

  listPublished(): Event[] {
    const rows = db
      .prepare(`${SELECT_EVENT} WHERE status = 'published' ORDER BY starts_at DESC`)
      .all() as EventRow[];
    return rows.map(toEvent);
  },

  /** 開催前（starts_at > now）の公開イベントを開催直前順（昇順）でページング取得 */
  listUpcomingPublished(now: number, limit: number, offset: number): Event[] {
    const rows = db
      .prepare(
        `${SELECT_EVENT}
         WHERE status = 'published' AND starts_at > ?
         ORDER BY starts_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(now, limit, offset) as EventRow[];
    return rows.map(toEvent);
  },

  countUpcomingPublished(now: number): number {
    return (db
      .prepare(
        "SELECT COUNT(1) AS n FROM event WHERE status = 'published' AND starts_at > ?",
      )
      .get(now) as { n: number }).n;
  },

  /** 管理向け: 全イベント */
  listAll(): Event[] {
    const rows = db
      .prepare(`${SELECT_EVENT} ORDER BY created_at DESC`)
      .all() as EventRow[];
    return rows.map(toEvent);
  },

  create(input: CreateEventInput, createdBy: string): Event {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO event
        (id, title, description, starts_at, ends_at, venue_type,
         venue_offline, venue_online, participation_type,
         aggregate_self_entry, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'individual', ?, 'draft', ?, ?)`,
    ).run(
      id,
      input.title,
      input.description ?? "",
      input.startsAt,
      input.endsAt,
      input.venueType,
      input.venueOffline ?? null,
      input.venueOnline ?? null,
      input.aggregateSelfEntry ? 1 : 0,
      createdBy,
      Date.now(),
    );
    return this.findById(id)!;
  },

  update(id: string, input: UpdateEventInput): Event | null {
    const current = this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    db.prepare(
      `UPDATE event SET
         title = ?, description = ?, starts_at = ?, ends_at = ?,
         venue_type = ?, venue_offline = ?, venue_online = ?,
         aggregate_self_entry = ?
       WHERE id = ?`,
    ).run(
      next.title,
      next.description,
      next.startsAt,
      next.endsAt,
      next.venueType,
      next.venueOffline ?? null,
      next.venueOnline ?? null,
      next.aggregateSelfEntry ? 1 : 0,
      id,
    );
    return this.findById(id);
  },

  setStatus(id: string, status: Event["status"]): Event | null {
    db.prepare("UPDATE event SET status = ? WHERE id = ?").run(status, id);
    return this.findById(id);
  },

  delete(id: string): void {
    // 関連（メンバー/エントリー/採点/画像/状態）は FK の ON DELETE CASCADE で削除
    db.prepare("DELETE FROM event WHERE id = ?").run(id);
  },
};
