import type { DateOption, VoteChoice } from "@eventer/shared";
import { many, one, run } from "../client.js";

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
       JOIN user u ON u.id = v.user_id
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
  ): Promise<string> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_date_option (id, event_id, starts_at, ends_at, sort_order, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      id,
      eventId,
      startsAt,
      endsAt,
      Date.now(),
    );
    return id;
  },

  async deleteOption(eventId: string, optionId: string): Promise<void> {
    await run(
      "DELETE FROM event_date_option WHERE id = ? AND event_id = ?",
      optionId,
      eventId,
    );
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

  async vote(
    optionId: string,
    userId: string,
    choice: VoteChoice,
  ): Promise<void> {
    await run(
      `INSERT INTO event_date_vote (id, option_id, user_id, choice, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(option_id, user_id) DO UPDATE SET choice = excluded.choice`,
      crypto.randomUUID(),
      optionId,
      userId,
      choice,
      Date.now(),
    );
  },
};
