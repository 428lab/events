import { eventRun, eventWrite, type EventWriter } from "./eventWriteGuard.js";
import type {
  CreateCriterionInput,
  ScoringCriterion,
  UpdateCriterionInput,
} from "@eventer/shared";
import { many, one, } from "../client.js";
import { savedText, type SavedDefaultKey } from "@eventer/shared";
import type { AppLanguage } from "@eventer/shared/i18n";

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

/** 既定の採点項目。作る人の言語で書いて保存する (#364) */
const DEFAULT_CRITERIA: Array<{ name: SavedDefaultKey; description: SavedDefaultKey }> = [
  { name: "criterionTechnical", description: "criterionTechnicalDesc" },
  { name: "criterionOriginality", description: "criterionOriginalityDesc" },
  { name: "criterionCompleteness", description: "criterionCompletenessDesc" },
  { name: "criterionPresentation", description: "criterionPresentationDesc" },
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
    input: CreateCriterionInput, writer: EventWriter): Promise<ScoringCriterion> {
    const id = crypto.randomUUID();
    const next = (await one<{ n: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM scoring_criterion WHERE event_id = ?",
      eventId,
    ))!.n;
    await eventRun(writer,
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
    input: UpdateCriterionInput, writer: EventWriter): Promise<ScoringCriterion | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next = { ...current, ...input };
    await eventRun(writer,
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

  async delete(id: string, writer: EventWriter): Promise<void> {
    await eventRun(writer,"DELETE FROM scoring_criterion WHERE id = ?", id);
  },

  /** デフォルト採点項目をシード（既に項目があれば何もしない） */
  async seedDefaults(eventId: string, writer: EventWriter, language?: AppLanguage): Promise<ScoringCriterion[]> {
    const existing = await this.listByEvent(eventId);
    if (existing.length > 0) return existing;
    const stmts = DEFAULT_CRITERIA.map((c, i) => ({
      sql: `INSERT INTO scoring_criterion (id, event_id, name, description, sort_order, max_level)
           VALUES (?, ?, ?, ?, ?, 4)`,
      args: [crypto.randomUUID(), eventId, savedText(language, c.name), savedText(language, c.description), i],
    }));
    await eventWrite(writer,stmts);
    return this.listByEvent(eventId);
  },
};
