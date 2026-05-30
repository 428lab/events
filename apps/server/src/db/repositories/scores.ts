import type {
  EntryScoreSummary,
  JudgeProgress,
  Score,
  ScoringCriterion,
} from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";
import { scoringCriteriaRepo } from "./scoringCriteria.js";

interface ScoreRow {
  entry_id: string;
  criterion_id: string;
  value: number;
}

export const scoresRepo = {
  /** ある採点者の採点一覧 */
  listForJudge(eventId: string, judgeUserId: string): Score[] {
    const rows = db
      .prepare(
        "SELECT entry_id, criterion_id, value FROM score WHERE event_id = ? AND judge_user_id = ?",
      )
      .all(eventId, judgeUserId) as ScoreRow[];
    return rows.map((r) => ({
      entryId: r.entry_id,
      criterionId: r.criterion_id,
      value: r.value,
    }));
  },

  upsert(
    eventId: string,
    entryId: string,
    criterionId: string,
    judgeUserId: string,
    value: number,
  ): void {
    const existing = db
      .prepare(
        "SELECT id FROM score WHERE entry_id = ? AND criterion_id = ? AND judge_user_id = ?",
      )
      .get(entryId, criterionId, judgeUserId) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE score SET value = ?, updated_at = ? WHERE id = ?").run(
        value,
        Date.now(),
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO score (id, event_id, entry_id, criterion_id, judge_user_id, value, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), eventId, entryId, criterionId, judgeUserId, value, Date.now());
    }
  },

  /**
   * 集計。aggregateSelfEntry=false の場合、採点者が対象 Entry のメンバーである
   * 採点を集計から除外する。
   */
  summary(eventId: string, aggregateSelfEntry: boolean): {
    criteria: ScoringCriterion[];
    entries: EntryScoreSummary[];
  } {
    const criteria = scoringCriteriaRepo.listByEvent(eventId);
    const entries = db
      .prepare("SELECT id, name FROM entry WHERE event_id = ? ORDER BY created_at ASC")
      .all(eventId) as Array<{ id: string; name: string }>;

    const selfFilter = aggregateSelfEntry
      ? ""
      : `AND NOT EXISTS (
           SELECT 1 FROM entry_member em
           WHERE em.entry_id = s.entry_id AND em.user_id = s.judge_user_id
         )`;

    const agg = db
      .prepare(
        `SELECT s.entry_id, s.criterion_id,
                SUM(s.value) AS total,
                COUNT(DISTINCT s.judge_user_id) AS judges
         FROM score s
         WHERE s.event_id = ? ${selfFilter}
         GROUP BY s.entry_id, s.criterion_id`,
      )
      .all(eventId) as Array<{
      entry_id: string;
      criterion_id: string;
      total: number;
      judges: number;
    }>;

    const summaries: EntryScoreSummary[] = entries.map((e) => {
      const perCriterion: Record<string, number> = {};
      for (const c of criteria) perCriterion[c.id] = 0;
      let total = 0;
      let judgeCount = 0;
      for (const row of agg) {
        if (row.entry_id !== e.id) continue;
        perCriterion[row.criterion_id] = row.total;
        total += row.total;
        judgeCount = Math.max(judgeCount, row.judges);
      }
      return {
        entryId: e.id,
        entryName: e.name,
        total,
        judgeCount,
        perCriterion,
      };
    });

    summaries.sort((a, b) => b.total - a.total);
    return { criteria, entries: summaries };
  },

  /** 採点者ごとの入力進捗（誰が未入力か） */
  progress(
    eventId: string,
    judgeRoles: string[],
    aggregateSelfEntry: boolean,
  ): JudgeProgress[] {
    const criteriaCount = scoringCriteriaRepo.listByEvent(eventId).length;
    const entryCount = (db
      .prepare("SELECT COUNT(*) AS n FROM entry WHERE event_id = ?")
      .get(eventId) as { n: number }).n;

    const placeholders = judgeRoles.map(() => "?").join(",");
    const judges = db
      .prepare(
        `SELECT m.user_id, m.role, u.username, u.global_name
         FROM event_member m
         JOIN user u ON u.id = m.user_id
         WHERE m.event_id = ? AND m.role IN (${placeholders})
         ORDER BY m.role, u.username`,
      )
      .all(eventId, ...judgeRoles) as Array<{
      user_id: string;
      role: string;
      username: string;
      global_name: string | null;
    }>;

    return judges.map((j) => {
      // 自己 Entry 除外時は、その採点者が所属する Entry 数を total から減らす
      const ownEntries = aggregateSelfEntry
        ? 0
        : (db
            .prepare(
              `SELECT COUNT(DISTINCT em.entry_id) AS n
               FROM entry_member em JOIN entry e ON e.id = em.entry_id
               WHERE e.event_id = ? AND em.user_id = ?`,
            )
            .get(eventId, j.user_id) as { n: number }).n;
      const total = (entryCount - ownEntries) * criteriaCount;
      const filled = (db
        .prepare(
          "SELECT COUNT(*) AS n FROM score WHERE event_id = ? AND judge_user_id = ?",
        )
        .get(eventId, j.user_id) as { n: number }).n;
      return {
        userId: j.user_id,
        name: j.global_name ?? j.username,
        role: j.role,
        filled,
        total,
        complete: total > 0 && filled >= total,
      };
    });
  },
};
