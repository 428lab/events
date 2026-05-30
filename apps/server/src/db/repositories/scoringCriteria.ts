import type {
  CreateCriterionInput,
  ScoringCriterion,
  UpdateCriterionInput,
} from "@eventer/shared";
import { randomUUID } from "node:crypto";
import { db } from "../client.js";

interface CriterionRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  max_level: number;
}

function toCriterion(row: CriterionRow): ScoringCriterion {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    maxLevel: row.max_level,
  };
}

const DEFAULT_CRITERIA: Array<{ name: string; description: string }> = [
  { name: "技術力", description: "実装の難易度・完成度" },
  { name: "独自性", description: "アイデアの新規性" },
  { name: "完成度", description: "動作・仕上がり" },
  { name: "プレゼン", description: "発表のわかりやすさ" },
];

export const scoringCriteriaRepo = {
  listByEvent(eventId: string): ScoringCriterion[] {
    const rows = db
      .prepare(
        "SELECT * FROM scoring_criterion WHERE event_id = ? ORDER BY sort_order ASC, rowid ASC",
      )
      .all(eventId) as CriterionRow[];
    return rows.map(toCriterion);
  },

  findById(id: string): ScoringCriterion | null {
    const row = db
      .prepare("SELECT * FROM scoring_criterion WHERE id = ?")
      .get(id) as CriterionRow | undefined;
    return row ? toCriterion(row) : null;
  },

  create(eventId: string, input: CreateCriterionInput): ScoringCriterion {
    const id = randomUUID();
    const next = (db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM scoring_criterion WHERE event_id = ?",
      )
      .get(eventId) as { n: number }).n;
    db.prepare(
      `INSERT INTO scoring_criterion (id, event_id, name, description, sort_order, max_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, eventId, input.name, input.description ?? null, next, input.maxLevel);
    return this.findById(id)!;
  },

  update(id: string, input: UpdateCriterionInput): ScoringCriterion | null {
    const current = this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    db.prepare(
      `UPDATE scoring_criterion SET name = ?, description = ?, sort_order = ?, max_level = ?
       WHERE id = ?`,
    ).run(next.name, next.description ?? null, next.sortOrder, next.maxLevel, id);
    return this.findById(id);
  },

  delete(id: string): void {
    db.prepare("DELETE FROM scoring_criterion WHERE id = ?").run(id);
  },

  /** デフォルト採点項目をシード（既に項目があれば何もしない） */
  seedDefaults(eventId: string): ScoringCriterion[] {
    const existing = this.listByEvent(eventId);
    if (existing.length > 0) return existing;
    const tx = db.transaction(() => {
      DEFAULT_CRITERIA.forEach((c, i) => {
        db.prepare(
          `INSERT INTO scoring_criterion (id, event_id, name, description, sort_order, max_level)
           VALUES (?, ?, ?, ?, ?, 4)`,
        ).run(randomUUID(), eventId, c.name, c.description, i);
      });
    });
    tx();
    return this.listByEvent(eventId);
  },
};
