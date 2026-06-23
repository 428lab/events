import type {
  AwardRank,
  CreateAwardRankInput,
  CreateSpecialAwardInput,
  SpecialAward,
  UpdateAwardRankInput,
  UpdateSpecialAwardInput,
} from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

interface RankRow {
  id: string;
  event_id: string;
  name: string;
  content: string | null;
  rank_order: number;
}
interface SpecialRow {
  id: string;
  event_id: string;
  name: string;
  content: string | null;
  sort_order: number;
}
export interface AwardResultRow {
  id: string;
  entry_id: string;
  award_rank_id: string | null;
  special_award_id: string | null;
}

const toRank = (r: RankRow): AwardRank => ({
  id: r.id,
  eventId: r.event_id,
  name: r.name,
  content: r.content,
  rankOrder: r.rank_order,
});
const toSpecial = (r: SpecialRow): SpecialAward => ({
  id: r.id,
  eventId: r.event_id,
  name: r.name,
  content: r.content,
  sortOrder: r.sort_order,
});

export const awardsRepo = {
  /* ranks */
  async listRanks(eventId: string): Promise<AwardRank[]> {
    return (
      await many<RankRow>(
        "SELECT * FROM award_rank WHERE event_id = ? ORDER BY rank_order ASC, rowid ASC",
        eventId,
      )
    ).map(toRank);
  },
  async findRank(id: string): Promise<AwardRank | null> {
    const r = await one<RankRow>(
      "SELECT * FROM award_rank WHERE id = ?",
      id,
    );
    return r ? toRank(r) : null;
  },
  async createRank(eventId: string, input: CreateAwardRankInput): Promise<AwardRank> {
    const id = crypto.randomUUID();
    const next = (await one<{ n: number }>(
      "SELECT COALESCE(MAX(rank_order), 0) + 1 AS n FROM award_rank WHERE event_id = ?",
      eventId,
    ))!.n;
    await run(
      "INSERT INTO award_rank (id, event_id, name, content, rank_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, eventId, input.name, input.content ?? null, next, Date.now(),
    );
    return (await this.findRank(id))!;
  },
  async updateRank(id: string, input: UpdateAwardRankInput): Promise<AwardRank | null> {
    const cur = await this.findRank(id);
    if (!cur) return null;
    const next = { ...cur, ...input };
    await run(
      "UPDATE award_rank SET name = ?, content = ?, rank_order = ? WHERE id = ?",
      next.name, next.content ?? null, next.rankOrder, id,
    );
    return this.findRank(id);
  },
  async deleteRank(id: string): Promise<void> {
    await run("DELETE FROM award_rank WHERE id = ?", id);
  },

  /* specials */
  async listSpecials(eventId: string): Promise<SpecialAward[]> {
    return (
      await many<SpecialRow>(
        "SELECT * FROM special_award WHERE event_id = ? ORDER BY sort_order ASC, rowid ASC",
        eventId,
      )
    ).map(toSpecial);
  },
  async createSpecial(eventId: string, input: CreateSpecialAwardInput): Promise<SpecialAward> {
    const id = crypto.randomUUID();
    const next = (await one<{ n: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM special_award WHERE event_id = ?",
      eventId,
    ))!.n;
    await run(
      "INSERT INTO special_award (id, event_id, name, content, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, eventId, input.name, input.content ?? null, next, Date.now(),
    );
    const row = (await one<SpecialRow>(
      "SELECT * FROM special_award WHERE id = ?",
      id,
    ))!;
    return toSpecial(row);
  },
  async findSpecial(id: string): Promise<SpecialAward | null> {
    const r = await one<SpecialRow>(
      "SELECT * FROM special_award WHERE id = ?",
      id,
    );
    return r ? toSpecial(r) : null;
  },
  async updateSpecial(id: string, input: UpdateSpecialAwardInput): Promise<SpecialAward | null> {
    const cur = await this.findSpecial(id);
    if (!cur) return null;
    const next = { ...cur, ...input };
    await run(
      "UPDATE special_award SET name = ?, content = ?, sort_order = ? WHERE id = ?",
      next.name, next.content ?? null, next.sortOrder, id,
    );
    return this.findSpecial(id);
  },
  async deleteSpecial(id: string): Promise<void> {
    await run("DELETE FROM special_award WHERE id = ?", id);
  },

  /* results */
  async listResults(eventId: string): Promise<AwardResultRow[]> {
    return many<AwardResultRow>(
      "SELECT id, entry_id, award_rank_id, special_award_id FROM award_result WHERE event_id = ?",
      eventId,
    );
  },
  /** ランク賞の受賞者を設定（1賞1エントリー。null で解除） */
  async setRankWinner(eventId: string, rankId: string, entryId: string | null): Promise<void> {
    if (entryId) {
      await batch([
        { sql: "DELETE FROM award_result WHERE award_rank_id = ?", args: [rankId] },
        {
          sql: "INSERT INTO award_result (id, event_id, entry_id, award_rank_id) VALUES (?, ?, ?, ?)",
          args: [crypto.randomUUID(), eventId, entryId, rankId],
        },
      ]);
    } else {
      await batch([
        { sql: "DELETE FROM award_result WHERE award_rank_id = ?", args: [rankId] },
      ]);
    }
  },
  async setSpecialWinner(eventId: string, specialId: string, entryId: string | null): Promise<void> {
    if (entryId) {
      await batch([
        { sql: "DELETE FROM award_result WHERE special_award_id = ?", args: [specialId] },
        {
          sql: "INSERT INTO award_result (id, event_id, entry_id, special_award_id) VALUES (?, ?, ?, ?)",
          args: [crypto.randomUUID(), eventId, entryId, specialId],
        },
      ]);
    } else {
      await batch([
        { sql: "DELETE FROM award_result WHERE special_award_id = ?", args: [specialId] },
      ]);
    }
  },
};
