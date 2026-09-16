import type { DateOption, VoteChoice } from "@eventer/shared";
import { eventViewSql } from "../../auth/eventAccess.js";
import { activeManagerSql, adminIds } from "./eventAccessInvites.js";
import { many, one, runCount } from "../client.js";

interface OptionRow {
  id: string;
  starts_at: number;
  ends_at: number;
}
interface VoteRow {
  option_id: string;
  choice: string;
  user_id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
}

export const schedulingRepo = {
  async listOptions(eventId: string): Promise<DateOption[]> {
    const options = await many<OptionRow>(
      "SELECT id, starts_at, ends_at FROM event_date_option WHERE event_id = ? ORDER BY starts_at ASC, sort_order ASC",
      eventId,
    );
    if (options.length === 0) return [];
    const votes = await many<VoteRow>(
      `SELECT v.option_id, v.choice, u.id AS user_id, u.username,
              u.global_name, u.avatar_url
       FROM event_date_vote v
       JOIN event_date_option o ON o.id = v.option_id
       JOIN user u ON u.id = v.user_id AND u.deleted_at IS NULL
       WHERE o.event_id = ?`,
      eventId,
    );
    return options.map((o) => {
      const vs = votes.filter((v) => v.option_id === o.id);
      const counts = { yes: 0, maybe: 0, no: 0 };
      for (const v of vs) counts[v.choice as VoteChoice] += 1;
      return {
        id: o.id,
        startsAt: o.starts_at,
        endsAt: o.ends_at,
        counts,
        voters: vs.map((v) => ({
          userId: v.user_id,
          username: v.username,
          name: v.global_name ?? v.username,
          avatarUrl: v.avatar_url,
          choice: v.choice as VoteChoice,
        })),
      };
    });
  },

  async myVotes(
    eventId: string,
    userId: string,
  ): Promise<Record<string, VoteChoice>> {
    const rows = await many<{ option_id: string; choice: string }>(
      `SELECT v.option_id, v.choice FROM event_date_vote v
       JOIN event_date_option o ON o.id = v.option_id
       WHERE o.event_id = ? AND v.user_id = ?`,
      eventId,
      userId,
    );
    const out: Record<string, VoteChoice> = {};
    for (const r of rows) out[r.option_id] = r.choice as VoteChoice;
    return out;
  },

  async addOption(
    eventId: string,
    startsAt: number,
    endsAt: number,
    actorId: string,
  ): Promise<string | null> {
    const id = crypto.randomUUID();
    const changed = await runCount(
      `INSERT INTO event_date_option (id, event_id, starts_at, ends_at, sort_order, created_at)
       SELECT ?,e.id,?,?,0,? FROM event e WHERE e.id=? AND ${activeManagerSql("e", "?")}`,
      id, startsAt, endsAt, Date.now(), eventId, actorId, adminIds(),
    );
    return changed ? id : null;
  },

  async deleteOption(eventId: string, optionId: string, actorId: string): Promise<boolean> {
    const changed = await runCount(
      `DELETE FROM event_date_option WHERE id=? AND event_id=? AND EXISTS (SELECT 1 FROM event e WHERE e.id=event_date_option.event_id AND ${activeManagerSql("e", "?")})`,
      optionId, eventId, actorId, adminIds(),
    );
    // Preserve authorized deletion replay without acknowledging a lost manager.
    return changed > 0 || Boolean(await one(`SELECT 1 FROM event e WHERE e.id=? AND ${activeManagerSql("e", "?")}`, eventId, actorId, adminIds()));
  },

  /** その option がイベントに属するか確認しつつ取得 */
  async getOption(
    eventId: string,
    optionId: string,
  ): Promise<{ startsAt: number; endsAt: number } | null> {
    const row = await one<OptionRow>(
      "SELECT id, starts_at, ends_at FROM event_date_option WHERE id = ? AND event_id = ?",
      optionId,
      eventId,
    );
    return row ? { startsAt: row.starts_at, endsAt: row.ends_at } : null;
  },

  /** このイベントの日程調整に回答した全ユーザーID（確定通知用） */
  async listVoterIds(eventId: string): Promise<string[]> {
    const rows = await many<{ user_id: string }>(
      `SELECT DISTINCT v.user_id FROM event_date_vote v
       JOIN event_date_option o ON o.id = v.option_id
       WHERE o.event_id = ?`,
      eventId,
    );
    return rows.map((r) => r.user_id);
  },

  async vote(
    eventId: string,
    optionId: string,
    userId: string,
    choice: VoteChoice,
  ): Promise<boolean> {
    return (await runCount(
      `INSERT INTO event_date_vote (id, option_id, user_id, choice, created_at)
       SELECT ?, o.id, u.id, ?, ? FROM event_date_option o
       JOIN event e ON e.id = o.event_id
       JOIN user u ON u.id = ? AND u.deleted_at IS NULL
       WHERE o.id = ? AND e.id = ? AND e.scheduling = 1
         AND ${eventViewSql("e", "u.id", "?")}
       ON CONFLICT(option_id, user_id) DO UPDATE SET choice = excluded.choice`,
      crypto.randomUUID(), choice, Date.now(), userId, optionId, eventId, adminIds(),
    )) > 0;
  },
};
