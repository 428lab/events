import type {
  AwardRank,
  CreateAwardRankInput,
  CreateSpecialAwardInput,
  SpecialAward,
  UpdateAwardRankInput,
  UpdateSpecialAwardInput,
} from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";

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
  listRanks(eventId: string): AwardRank[] {
    return (
      db
        .prepare(
          "SELECT * FROM award_rank WHERE event_id = ? ORDER BY rank_order ASC, rowid ASC",
        )
        .all(eventId) as RankRow[]
    ).map(toRank);
  },
  findRank(id: string): AwardRank | null {
    const r = db.prepare("SELECT * FROM award_rank WHERE id = ?").get(id) as
      | RankRow
      | undefined;
    return r ? toRank(r) : null;
  },
  createRank(eventId: string, input: CreateAwardRankInput): AwardRank {
    const id = randomUUID();
    const next = (db
      .prepare(
        "SELECT COALESCE(MAX(rank_order), 0) + 1 AS n FROM award_rank WHERE event_id = ?",
      )
      .get(eventId) as { n: number }).n;
    db.prepare(
      "INSERT INTO award_rank (id, event_id, name, content, rank_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, eventId, input.name, input.content ?? null, next, Date.now());
    return this.findRank(id)!;
  },
  updateRank(id: string, input: UpdateAwardRankInput): AwardRank | null {
    const cur = this.findRank(id);
    if (!cur) return null;
    const next = { ...cur, ...input };
    db.prepare(
      "UPDATE award_rank SET name = ?, content = ?, rank_order = ? WHERE id = ?",
    ).run(next.name, next.content ?? null, next.rankOrder, id);
    return this.findRank(id);
  },
  deleteRank(id: string): void {
    db.prepare("DELETE FROM award_rank WHERE id = ?").run(id);
  },

  /* specials */
  listSpecials(eventId: string): SpecialAward[] {
    return (
      db
        .prepare(
          "SELECT * FROM special_award WHERE event_id = ? ORDER BY sort_order ASC, rowid ASC",
        )
        .all(eventId) as SpecialRow[]
    ).map(toSpecial);
  },
  createSpecial(eventId: string, input: CreateSpecialAwardInput): SpecialAward {
    const id = randomUUID();
    const next = (db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM special_award WHERE event_id = ?",
      )
      .get(eventId) as { n: number }).n;
    db.prepare(
      "INSERT INTO special_award (id, event_id, name, content, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, eventId, input.name, input.content ?? null, next, Date.now());
    const row = db
      .prepare("SELECT * FROM special_award WHERE id = ?")
      .get(id) as SpecialRow;
    return toSpecial(row);
  },
  findSpecial(id: string): SpecialAward | null {
    const r = db.prepare("SELECT * FROM special_award WHERE id = ?").get(id) as
      | SpecialRow
      | undefined;
    return r ? toSpecial(r) : null;
  },
  updateSpecial(id: string, input: UpdateSpecialAwardInput): SpecialAward | null {
    const cur = this.findSpecial(id);
    if (!cur) return null;
    const next = { ...cur, ...input };
    db.prepare(
      "UPDATE special_award SET name = ?, content = ?, sort_order = ? WHERE id = ?",
    ).run(next.name, next.content ?? null, next.sortOrder, id);
    return this.findSpecial(id);
  },
  deleteSpecial(id: string): void {
    db.prepare("DELETE FROM special_award WHERE id = ?").run(id);
  },

  /* results */
  listResults(eventId: string): AwardResultRow[] {
    return db
      .prepare("SELECT id, entry_id, award_rank_id, special_award_id FROM award_result WHERE event_id = ?")
      .all(eventId) as AwardResultRow[];
  },
  /** ランク賞の受賞者を設定（1賞1エントリー。null で解除） */
  setRankWinner(eventId: string, rankId: string, entryId: string | null): void {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM award_result WHERE award_rank_id = ?").run(rankId);
      if (entryId) {
        db.prepare(
          "INSERT INTO award_result (id, event_id, entry_id, award_rank_id) VALUES (?, ?, ?, ?)",
        ).run(randomUUID(), eventId, entryId, rankId);
      }
    });
    tx();
  },
  setSpecialWinner(eventId: string, specialId: string, entryId: string | null): void {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM award_result WHERE special_award_id = ?").run(specialId);
      if (entryId) {
        db.prepare(
          "INSERT INTO award_result (id, event_id, entry_id, special_award_id) VALUES (?, ?, ?, ?)",
        ).run(randomUUID(), eventId, entryId, specialId);
      }
    });
    tx();
  },
};
