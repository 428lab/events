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
  contest_mode: number;
  status: string;
  created_by: string;
  created_at: number;
  image_updated_at: number | null;
  participant_count: number;
  community_id: string | null;
  scheduling: number;
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
    contestMode: row.contest_mode === 1,
    status: row.status as Event["status"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    imageUpdatedAt: row.image_updated_at,
    participantCount: row.participant_count,
    communityId: row.community_id ?? null,
    scheduling: row.scheduling === 1,
  };
}

export interface EventSearchOpts {
  q?: string;
  /** この時刻以降に終わるイベント（期間の開始） */
  from?: number;
  /** この時刻以前に始まるイベント（期間の終了） */
  to?: number;
  /** この時刻以降に始まるイベント（「続きを見る」での継続表示用） */
  after?: number;
  communityId?: string;
  sort?: "soon" | "recent" | "new";
  limit: number;
  offset: number;
}

function buildSearchWhere(o: EventSearchOpts): {
  where: string;
  args: (string | number)[];
} {
  const conds = ["status = 'published'"];
  const args: (string | number)[] = [];
  if (o.q) {
    conds.push("(title LIKE ? OR description LIKE ?)");
    const like = `%${o.q}%`;
    args.push(like, like);
  }
  if (o.from != null) {
    conds.push("ends_at >= ?");
    args.push(o.from);
  }
  if (o.to != null) {
    conds.push("starts_at <= ?");
    args.push(o.to);
  }
  if (o.after != null) {
    conds.push("starts_at >= ?");
    args.push(o.after);
  }
  if (o.communityId) {
    conds.push("community_id = ?");
    args.push(o.communityId);
  }
  return { where: conds.join(" AND "), args };
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

  /** コミュニティに所属する公開イベント（開始の降順） */
  async listByCommunity(communityId: string): Promise<Event[]> {
    const rows = await many<EventRow>(
      `${SELECT_EVENT} WHERE community_id = ? AND status = 'published' ORDER BY starts_at DESC`,
      communityId,
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
         WHERE status = 'published' AND (scheduling = 1 OR ends_at > ?)
         ORDER BY scheduling DESC, starts_at ASC
         LIMIT ? OFFSET ?`,
      now,
      limit,
      offset,
    );
    return rows.map(toEvent);
  },

  async countUpcomingPublished(now: number): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event WHERE status = 'published' AND (scheduling = 1 OR ends_at > ?)",
      now,
    );
    return row?.n ?? 0;
  },

  /** 開催済み（ends_at <= now・日程調整中は除く）の公開イベントを終了が新しい順で取得 */
  async listPastPublished(
    now: number,
    limit: number,
    offset: number,
  ): Promise<Event[]> {
    const rows = await many<EventRow>(
      `${SELECT_EVENT}
         WHERE status = 'published' AND scheduling = 0 AND ends_at <= ?
         ORDER BY ends_at DESC
         LIMIT ? OFFSET ?`,
      now,
      limit,
      offset,
    );
    return rows.map(toEvent);
  },

  async countPastPublished(now: number): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event WHERE status = 'published' AND scheduling = 0 AND ends_at <= ?",
      now,
    );
    return row?.n ?? 0;
  },

  /** 公開イベントの検索（キーワード・期間・コミュニティ・並び替え） */
  async searchPublished(o: EventSearchOpts): Promise<Event[]> {
    const { where, args } = buildSearchWhere(o);
    const order =
      o.sort === "recent"
        ? "starts_at DESC"
        : o.sort === "new"
          ? "created_at DESC"
          : "starts_at ASC";
    const rows = await many<EventRow>(
      `${SELECT_EVENT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...args,
      o.limit,
      o.offset,
    );
    return rows.map(toEvent);
  },

  async countSearchPublished(o: EventSearchOpts): Promise<number> {
    const { where, args } = buildSearchWhere(o);
    const row = await one<{ n: number }>(
      `SELECT COUNT(1) AS n FROM event WHERE ${where}`,
      ...args,
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
         aggregate_self_entry, contest_mode, status, created_by, created_at,
         community_id, scheduling)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'individual', ?, ?, 'draft', ?, ?, ?, ?)`,
      id,
      input.title,
      input.description ?? "",
      input.startsAt ?? 0,
      input.endsAt ?? 0,
      input.venueType,
      input.venueOffline ?? null,
      input.venueOnline ?? null,
      input.aggregateSelfEntry ? 1 : 0,
      input.contestMode ? 1 : 0,
      createdBy,
      Date.now(),
      input.communityId ?? null,
      input.scheduling ? 1 : 0,
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
         aggregate_self_entry = ?, contest_mode = ?, status = ?,
         community_id = ?
       WHERE id = ?`,
      next.title,
      next.description,
      next.startsAt,
      next.endsAt,
      next.venueType,
      next.venueOffline ?? null,
      next.venueOnline ?? null,
      next.aggregateSelfEntry ? 1 : 0,
      next.contestMode ? 1 : 0,
      next.status,
      next.communityId ?? null,
      id,
    );
    return this.findById(id);
  },

  async setStatus(id: string, status: Event["status"]): Promise<Event | null> {
    await run("UPDATE event SET status = ? WHERE id = ?", status, id);
    return this.findById(id);
  },

  /** 日程調整を確定：開始/終了日時を設定し scheduling を解除 */
  async finalizeDate(
    id: string,
    startsAt: number,
    endsAt: number,
  ): Promise<Event | null> {
    await run(
      "UPDATE event SET starts_at = ?, ends_at = ?, scheduling = 0 WHERE id = ?",
      startsAt,
      endsAt,
      id,
    );
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    // 関連（メンバー/エントリー/採点/画像/状態）は FK の ON DELETE CASCADE で削除
    await run("DELETE FROM event WHERE id = ?", id);
  },
};
