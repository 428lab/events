import type {
  CreateEventInput,
  Event,
  UpdateEventInput,
} from "@eventer/shared";
import { many, one, run } from "../client.js";

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

/** participant_count（確定メンバー数）を含む event の SELECT */
const SELECT_EVENT = `SELECT *,
  (SELECT COUNT(1) FROM event_member em
   WHERE em.event_id = event.id AND em.status = 'confirmed') AS participant_count
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
  async findById(id: string): Promise<Event | null> {
    const row = await one<EventRow>(`${SELECT_EVENT} WHERE id = ?`, id);
    return row ? toEvent(row) : null;
  },

  async listPublished(): Promise<Event[]> {
    const rows = await many<EventRow>(
      `${SELECT_EVENT} WHERE status = 'published' ORDER BY starts_at DESC`,
    );
    return rows.map(toEvent);
  },

  /** 開催前＋開催中（ends_at > now）の公開イベントを開催直前順（開始昇順）でページング取得 */
  async listUpcomingPublished(
    now: number,
    limit: number,
    offset: number,
  ): Promise<Event[]> {
    const rows = await many<EventRow>(
      `${SELECT_EVENT}
         WHERE status = 'published' AND ends_at > ?
         ORDER BY starts_at ASC
         LIMIT ? OFFSET ?`,
      now,
      limit,
      offset,
    );
    return rows.map(toEvent);
  },

  async countUpcomingPublished(now: number): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event WHERE status = 'published' AND ends_at > ?",
      now,
    );
    return row?.n ?? 0;
  },

  /** 管理向け: 全イベント */
  async listAll(): Promise<Event[]> {
    const rows = await many<EventRow>(`${SELECT_EVENT} ORDER BY created_at DESC`);
    return rows.map(toEvent);
  },

  async create(input: CreateEventInput, createdBy: string): Promise<Event> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event
        (id, title, description, starts_at, ends_at, venue_type,
         venue_offline, venue_online, participation_type,
         aggregate_self_entry, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'individual', ?, 'draft', ?, ?)`,
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
    return (await this.findById(id))!;
  },

  async update(id: string, input: UpdateEventInput): Promise<Event | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    await run(
      `UPDATE event SET
         title = ?, description = ?, starts_at = ?, ends_at = ?,
         venue_type = ?, venue_offline = ?, venue_online = ?,
         aggregate_self_entry = ?, status = ?
       WHERE id = ?`,
      next.title,
      next.description,
      next.startsAt,
      next.endsAt,
      next.venueType,
      next.venueOffline ?? null,
      next.venueOnline ?? null,
      next.aggregateSelfEntry ? 1 : 0,
      next.status,
      id,
    );
    return this.findById(id);
  },

  async setStatus(id: string, status: Event["status"]): Promise<Event | null> {
    await run("UPDATE event SET status = ? WHERE id = ?", status, id);
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    // 関連（メンバー/エントリー/採点/画像/状態）は FK の ON DELETE CASCADE で削除
    await run("DELETE FROM event WHERE id = ?", id);
  },
};
