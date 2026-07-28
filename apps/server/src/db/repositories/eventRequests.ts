import type {
  CreateEventRequestInput,
  EventRequest,
  EventRequestReaction,
} from "@eventer/shared";
import { many, one, run } from "../client.js";

interface EventRequestRow {
  id: string;
  title: string;
  description: string;
  venue_type_pref: string | null;
  community_id: string | null;
  members_only: number;
  status: string;
  created_by: string;
  created_at: number;
  attend_count: number;
  host_count: number;
  event_count: number;
}

/** 賛同数・リンクイベント数を含む event_request の SELECT */
const SELECT_REQUEST = `SELECT er.*,
  (SELECT COUNT(1) FROM event_request_reaction r
    WHERE r.request_id = er.id AND r.kind = 'attend') AS attend_count,
  (SELECT COUNT(1) FROM event_request_reaction r
    WHERE r.request_id = er.id AND r.kind = 'host') AS host_count,
  (SELECT COUNT(1) FROM event_request_event e
    WHERE e.request_id = er.id) AS event_count
  FROM event_request er`;

function toRequest(row: EventRequestRow): EventRequest {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    venueTypePref: row.venue_type_pref as EventRequest["venueTypePref"],
    communityId: row.community_id,
    membersOnly: row.members_only === 1,
    status: row.status as EventRequest["status"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    attendCount: row.attend_count,
    hostCount: row.host_count,
    eventCount: row.event_count,
  };
}

export const eventRequestsRepo = {
  async findById(id: string): Promise<EventRequest | null> {
    const row = await one<EventRequestRow>(
      `${SELECT_REQUEST} WHERE er.id = ?`,
      id,
    );
    return row ? toRequest(row) : null;
  },

  /** 全体公開のたまご一覧（コミュニティ内のメンバー限定は除外） */
  async listPublic(
    status: "open" | "closed",
    limit: number,
    offset: number,
  ): Promise<EventRequest[]> {
    const rows = await many<EventRequestRow>(
      `${SELECT_REQUEST}
        WHERE er.status = ? AND er.members_only = 0
        ORDER BY er.created_at DESC LIMIT ? OFFSET ?`,
      status,
      limit,
      offset,
    );
    return rows.map(toRequest);
  },

  async countPublic(status: "open" | "closed"): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_request WHERE status = ? AND members_only = 0",
      status,
    );
    return row?.n ?? 0;
  },

  /** コミュニティのたまご一覧（メンバー限定を含むかは呼び出し側の権限判定で切替） */
  async listByCommunity(
    communityId: string,
    includeMembersOnly: boolean,
    status: "open" | "closed",
  ): Promise<EventRequest[]> {
    const rows = await many<EventRequestRow>(
      `${SELECT_REQUEST}
        WHERE er.community_id = ? AND er.status = ?
          ${includeMembersOnly ? "" : "AND er.members_only = 0"}
        ORDER BY er.created_at DESC`,
      communityId,
      status,
    );
    return rows.map(toRequest);
  },

  async create(
    input: CreateEventRequestInput,
    createdBy: string,
  ): Promise<EventRequest> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_request
        (id, title, description, venue_type_pref, community_id, members_only,
         status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      id,
      input.title,
      input.description ?? "",
      input.venueTypePref ?? null,
      input.communityId ?? null,
      input.communityId && input.membersOnly ? 1 : 0,
      createdBy,
      Date.now(),
    );
    return (await this.findById(id))!;
  },

  async setStatus(id: string, status: "open" | "closed"): Promise<void> {
    await run("UPDATE event_request SET status = ? WHERE id = ?", status, id);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM event_request WHERE id = ?", id);
  },

  /** 賛同のオンオフ */
  async setReaction(
    requestId: string,
    userId: string,
    kind: EventRequestReaction,
    on: boolean,
  ): Promise<void> {
    if (on) {
      await run(
        `INSERT OR IGNORE INTO event_request_reaction
          (request_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)`,
        requestId,
        userId,
        kind,
        Date.now(),
      );
    } else {
      await run(
        "DELETE FROM event_request_reaction WHERE request_id = ? AND user_id = ? AND kind = ?",
        requestId,
        userId,
        kind,
      );
    }
  },

  /** 自分の賛同状態 */
  async myReactions(
    requestId: string,
    userId: string,
  ): Promise<EventRequestReaction[]> {
    const rows = await many<{ kind: string }>(
      "SELECT kind FROM event_request_reaction WHERE request_id = ? AND user_id = ?",
      requestId,
      userId,
    );
    return rows.map((r) => r.kind as EventRequestReaction);
  },

  /** 賛同者（通知用）。投稿者は含まない */
  async reactorUserIds(requestId: string): Promise<string[]> {
    const rows = await many<{ user_id: string }>(
      "SELECT DISTINCT user_id FROM event_request_reaction WHERE request_id = ?",
      requestId,
    );
    return rows.map((r) => r.user_id);
  },

  /** 開催宣言: イベントをリンク */
  async linkEvent(requestId: string, eventId: string): Promise<void> {
    await run(
      `INSERT OR IGNORE INTO event_request_event (request_id, event_id, created_at)
       VALUES (?, ?, ?)`,
      requestId,
      eventId,
      Date.now(),
    );
  },

  /** イベントにリンクされた未通知のリクエストID（公開時の通知用） */
  async unnotifiedRequestIdsForEvent(eventId: string): Promise<string[]> {
    const rows = await many<{ request_id: string }>(
      "SELECT request_id FROM event_request_event WHERE event_id = ? AND notified_at = 0",
      eventId,
    );
    return rows.map((r) => r.request_id);
  },

  async markNotified(requestId: string, eventId: string): Promise<void> {
    await run(
      "UPDATE event_request_event SET notified_at = ? WHERE request_id = ? AND event_id = ?",
      Date.now(),
      requestId,
      eventId,
    );
  },

  /** リンク済みイベントID一覧（新しい順） */
  async linkedEventIds(requestId: string): Promise<string[]> {
    const rows = await many<{ event_id: string }>(
      "SELECT event_id FROM event_request_event WHERE request_id = ? ORDER BY created_at DESC",
      requestId,
    );
    return rows.map((r) => r.event_id);
  },
};
