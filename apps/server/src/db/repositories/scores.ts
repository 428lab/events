import type {
  EntryScoreSummary,
  JudgeProgress,
  Score,
  ScoringCriterion,
} from "@eventer/shared";
import { many, one, run } from "../client.js";
import { scoringCriteriaRepo } from "./scoringCriteria.js";
import { entryDisplayNameSql } from "./entries.js";

interface ScoreRow {
  entry_id: string;
  criterion_id: string;
  value: number;
}

export const scoresRepo = {
  /** ある採点者の採点一覧 */
  async listForJudge(eventId: string, judgeUserId: string): Promise<Score[]> {
    const rows = await many<ScoreRow>(
      "SELECT entry_id, criterion_id, value FROM score WHERE event_id = ? AND judge_user_id = ?",
      eventId,
      judgeUserId,
    );
    return rows.map((r) => ({
      entryId: r.entry_id,
      criterionId: r.criterion_id,
      value: r.value,
    }));
  },

  async upsert(
    eventId: string,
    entryId: string,
    criterionId: string,
    judgeUserId: string,
    value: number,
  ): Promise<void> {
    const existing = await one<{ id: string }>(
      "SELECT id FROM score WHERE entry_id = ? AND criterion_id = ? AND judge_user_id = ?",
      entryId,
      criterionId,
      judgeUserId,
    );
    if (existing) {
      await run(
        "UPDATE score SET value = ?, updated_at = ? WHERE id = ?",
        value,
        Date.now(),
        existing.id,
      );
    } else {
      await run(
        `INSERT INTO score (id, event_id, entry_id, criterion_id, judge_user_id, value, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        eventId,
        entryId,
        criterionId,
        judgeUserId,
        value,
        Date.now(),
      );
    }
  },

  /**
   * 集計。aggregateSelfEntry=false の場合、採点者が対象 Entry のメンバーである
   * 採点を集計から除外する。
   */
  async summary(
    eventId: string,
    aggregateSelfEntry: boolean,
  ): Promise<{
    criteria: ScoringCriterion[];
    entries: EntryScoreSummary[];
  }> {
    const criteria = await scoringCriteriaRepo.listByEvent(eventId);
    // 採点結果・表彰結果 (routes/awards.ts の entryName) はここの name を使う。
    // 退会申請中 (#250) の個人エントリーは表示名を伏せる
    const entries = await many<{ id: string; name: string }>(
      `SELECT e.id, ${entryDisplayNameSql("e")} AS name
         FROM entry e WHERE e.event_id = ? ORDER BY e.created_at ASC`,
      eventId,
    );

    const selfFilter = aggregateSelfEntry
      ? ""
      : `AND NOT EXISTS (
           SELECT 1 FROM entry_member em
           WHERE em.entry_id = s.entry_id AND em.user_id = s.judge_user_id
         )`;

    const agg = await many<{
      entry_id: string;
      criterion_id: string;
      total: number;
      judges: number;
    }>(
      `SELECT s.entry_id, s.criterion_id,
                SUM(s.value) AS total,
                COUNT(DISTINCT s.judge_user_id) AS judges
         FROM score s
         WHERE s.event_id = ? ${selfFilter}
         GROUP BY s.entry_id, s.criterion_id`,
      eventId,
    );

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
  async progress(
    eventId: string,
    judgeRoles: string[],
    aggregateSelfEntry: boolean,
  ): Promise<JudgeProgress[]> {
    const criteriaCount = (await scoringCriteriaRepo.listByEvent(eventId)).length;
    const entryCountRow = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entry WHERE event_id = ?",
      eventId,
    );
    const entryCount = entryCountRow?.n ?? 0;

    const placeholders = judgeRoles.map(() => "?").join(",");
    const judges = await many<{
      user_id: string;
      role: string;
      username: string;
      global_name: string | null;
    }>(
      `SELECT m.user_id, m.role, u.username, u.global_name
         FROM event_member m
         JOIN user u ON u.id = m.user_id
         WHERE m.event_id = ? AND m.status <> 'canceled'
           AND m.role IN (${placeholders}) AND u.deleted_at IS NULL
         ORDER BY m.role, u.username`,
      eventId,
      ...judgeRoles,
    );

    const result: JudgeProgress[] = [];
    for (const j of judges) {
      // 自己 Entry 除外時は、その採点者が所属する Entry 数を total から減らす
      let ownEntries = 0;
      if (!aggregateSelfEntry) {
        const ownRow = await one<{ n: number }>(
          `SELECT COUNT(DISTINCT em.entry_id) AS n
               FROM entry_member em JOIN entry e ON e.id = em.entry_id
               WHERE e.event_id = ? AND em.user_id = ?`,
          eventId,
          j.user_id,
        );
        ownEntries = ownRow?.n ?? 0;
      }
      const total = (entryCount - ownEntries) * criteriaCount;
      const filledRow = await one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM score WHERE event_id = ? AND judge_user_id = ?",
        eventId,
        j.user_id,
      );
      const filled = filledRow?.n ?? 0;
      result.push({
        userId: j.user_id,
        name: j.global_name ?? j.username,
        role: j.role,
        filled,
        total,
        complete: total > 0 && filled >= total,
      });
    }
    return result;
  },
};
