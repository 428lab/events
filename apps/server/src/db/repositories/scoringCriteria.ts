import type {
  CreateCriterionInput,
  ScoringCriterion,
  UpdateCriterionInput,
} from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

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
  async listByEvent(eventId: string): Promise<ScoringCriterion[]> {
    const rows = await many<CriterionRow>(
      "SELECT * FROM scoring_criterion WHERE event_id = ? ORDER BY sort_order ASC, rowid ASC",
      eventId,
    );
    return rows.map(toCriterion);
  },

  async findById(id: string): Promise<ScoringCriterion | null> {
    const row = await one<CriterionRow>(
      "SELECT * FROM scoring_criterion WHERE id = ?",
      id,
    );
    return row ? toCriterion(row) : null;
  },

  async create(
    eventId: string,
    input: CreateCriterionInput,
  ): Promise<ScoringCriterion> {
    const id = crypto.randomUUID();
    const next = (await one<{ n: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM scoring_criterion WHERE event_id = ?",
      eventId,
    ))!.n;
    await run(
      `INSERT INTO scoring_criterion (id, event_id, name, description, sort_order, max_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      eventId,
      input.name,
      input.description ?? null,
      next,
      input.maxLevel,
    );
    return (await this.findById(id))!;
  },

  async update(
    id: string,
    input: UpdateCriterionInput,
  ): Promise<ScoringCriterion | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    await run(
      `UPDATE scoring_criterion SET name = ?, description = ?, sort_order = ?, max_level = ?
       WHERE id = ?`,
      next.name,
      next.description ?? null,
      next.sortOrder,
      next.maxLevel,
      id,
    );
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    await run("DELETE FROM scoring_criterion WHERE id = ?", id);
  },

  /** デフォルト採点項目をシード（既に項目があれば何もしない） */
  async seedDefaults(eventId: string): Promise<ScoringCriterion[]> {
    const existing = await this.listByEvent(eventId);
    if (existing.length > 0) return existing;
    const stmts = DEFAULT_CRITERIA.map((c, i) => ({
      sql: `INSERT INTO scoring_criterion (id, event_id, name, description, sort_order, max_level)
           VALUES (?, ?, ?, ?, ?, 4)`,
      args: [crypto.randomUUID(), eventId, c.name, c.description, i],
    }));
    await batch(stmts);
    return this.listByEvent(eventId);
  },
};
