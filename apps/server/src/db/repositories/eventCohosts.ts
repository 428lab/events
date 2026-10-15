import { eventRun } from "./eventWriteGuard.js";
import { MAX_EVENT_COHOSTS } from "@eventer/shared";
import type {
  CommunityCohost,
  EventCohost,
  EventCohostStatus,
  Event,
} from "@eventer/shared";
import { many, one, runCount } from "../client.js";
import { eventViewSql } from "../../auth/eventAccess.js";
import { adminIds } from "./eventAccessInvites.js";

/** イベントの共催コミュニティ (#625)。docs/event-cohost.md
 *
 * **この表は権限にも集計にも効かない。** eventManagerSql / eventViewSql・KPI・
 * event_count・所属表示はどれもここを読まない。読むのは詳細ページの表示と、
 * 共催側コミュニティページの一覧（events.ts の buildSearchWhere）だけ。 */

interface CohostRow {
  event_id: string;
  community_id: string;
  status: string;
  created_at: number;
  responded_at: number | null;
}

interface EventCohostRow extends CohostRow {
  slug: string;
  name: string;
  icon_url: string | null;
}

interface CommunityCohostRow extends CohostRow {
  e_title: string;
  e_starts_at: number;
  e_status: string;
  e_visibility: string | null;
  host_name: string | null;
  can_view: number;
}

/** 表示順: 共催中（承認順）→ 承認待ち（申請順）。主催はこの前に来る */
const ORDER = `ORDER BY CASE ec.status WHEN 'accepted' THEN 0 ELSE 1 END,
  CASE ec.status WHEN 'accepted' THEN ec.responded_at ELSE ec.created_at END, ec.community_id`;

export interface CohostRecord {
  eventId: string;
  communityId: string;
  status: EventCohostStatus;
  createdAt: number;
  respondedAt: number | null;
}

function toRecord(row: CohostRow): CohostRecord {
  return {
    eventId: row.event_id,
    communityId: row.community_id,
    status: row.status as EventCohostStatus,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

export const eventCohostsRepo = {
  /** イベントの共催一覧。acceptedOnly は公開側（詳細ページ）向け */
  async listByEvent(
    eventId: string,
    opts: { acceptedOnly?: boolean } = {},
  ): Promise<EventCohost[]> {
    const rows = await many<EventCohostRow>(
      `SELECT ec.*, c.slug, c.name, c.icon_url FROM event_cohost ec
         JOIN community c ON c.id = ec.community_id
       WHERE ec.event_id = ? ${opts.acceptedOnly ? "AND ec.status = 'accepted'" : ""}
       ${ORDER}`,
      eventId,
    );
    return rows.map((r) => ({
      communityId: r.community_id,
      slug: r.slug,
      name: r.name,
      iconUrl: r.icon_url,
      status: r.status as EventCohostStatus,
      createdAt: r.created_at,
      respondedAt: r.responded_at,
    }));
  },

  /** 共催先コミュニティから見た依頼中・共催中の一覧（owner/admin 向け）。
   * 閲覧者（viewerId）がそのイベントを閲覧できない行は、題名・開始日時・主催名を伏せて
   * null で返す（下書き・非公開のまま依頼が来た／承認後に非公開にされた行）。
   * 承諾・辞退・解除に要る eventId と状態は残す。判定は既存の eventViewSql */
  async listByCommunity(communityId: string, viewerId: string): Promise<CommunityCohost[]> {
    const rows = await many<CommunityCohostRow>(
      `SELECT ec.*, e.title AS e_title, e.starts_at AS e_starts_at, e.status AS e_status,
         e.visibility AS e_visibility, hc.name AS host_name,
         ${eventViewSql("e", "?2", "?1")} AS can_view
       FROM event_cohost ec
         JOIN event e ON e.id = ec.event_id
         LEFT JOIN community hc ON hc.id = e.community_id
       WHERE ec.community_id = ?3
       ${ORDER}`,
      adminIds(),
      viewerId,
      communityId,
    );
    return rows.map((r) => {
      const visible = r.can_view === 1;
      return {
        eventId: r.event_id,
        eventTitle: visible ? r.e_title : null,
        eventStartsAt: visible ? r.e_starts_at : null,
        eventStatus: r.e_status as Event["status"],
        eventVisibility: (r.e_visibility ?? "public") as Event["visibility"],
        hostCommunityName: visible ? r.host_name : null,
        status: r.status as EventCohostStatus,
        createdAt: r.created_at,
        respondedAt: r.responded_at,
      };
    });
  },

  async find(eventId: string, communityId: string): Promise<CohostRecord | null> {
    const row = await one<CohostRow>(
      "SELECT * FROM event_cohost WHERE event_id = ? AND community_id = ?",
      eventId,
      communityId,
    );
    return row ? toRecord(row) : null;
  },

  /** 共催の依頼を受け取る人＝そのコミュニティの owner/admin 全員（退会申請中は除く） */
  async managerIds(communityId: string): Promise<string[]> {
    const rows = await many<{ user_id: string }>(
      `SELECT cm.user_id FROM community_member cm
         JOIN user u ON u.id = cm.user_id AND u.deleted_at IS NULL
       WHERE cm.community_id = ? AND cm.role IN ('owner', 'admin')`,
      communityId,
    );
    return rows.map((r) => r.user_id);
  },

  /** 承認待ちを含む件数（上限の判定用） */
  async countByEvent(eventId: string): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_cohost WHERE event_id = ?",
      eventId,
    );
    return row?.n ?? 0;
  },

  /** 承認待ちで申請する（イベントの管理者として）。
   * 上限は同じ文の中でも数える。画面の二重送信で上限を超えないようにするため。
   * 作れなかった（上限・既にある）ときは false */
  async create(eventId: string, communityId: string, actorId: string): Promise<boolean> {
    const changed = await eventRun(
      { eventId, actorId, permission: "manager" },
      `INSERT INTO event_cohost (event_id, community_id, status, created_at, responded_at)
       SELECT ?, ?, 'pending', ?, NULL
       WHERE (SELECT COUNT(1) FROM event_cohost WHERE event_id = ?) < ?
       ON CONFLICT(event_id, community_id) DO NOTHING`,
      eventId,
      communityId,
      Date.now(),
      eventId,
      MAX_EVENT_COHOSTS,
    );
    return changed > 0;
  },

  /** 承認する（共催先の owner/admin として。権限はルートで確かめる）。承認待ちのときだけ進む */
  async accept(eventId: string, communityId: string): Promise<boolean> {
    const changed = await runCount(
      `UPDATE event_cohost SET status = 'accepted', responded_at = ?
       WHERE event_id = ? AND community_id = ? AND status = 'pending'`,
      Date.now(),
      eventId,
      communityId,
    );
    return changed > 0;
  },

  /** 行を消す（取り下げ・却下・共催をやめる）。
   * actorId を渡したときはイベントの管理者としての書き込みにする（主催側の取り下げ）。
   * status を渡したときはその状態の行だけ消す（却下と取り消しの同時押しで取り違えないため） */
  async remove(
    eventId: string,
    communityId: string,
    opts: { actorId?: string; status?: EventCohostStatus } = {},
  ): Promise<boolean> {
    const sql = `DELETE FROM event_cohost WHERE event_id = ? AND community_id = ?${
      opts.status ? " AND status = ?" : ""
    }`;
    const args: unknown[] = [eventId, communityId, ...(opts.status ? [opts.status] : [])];
    const changed = opts.actorId
      ? await eventRun({ eventId, actorId: opts.actorId, permission: "manager" }, sql, ...args)
      : await runCount(sql, ...args);
    return changed > 0;
  },
};
