import { z } from "zod";
import { EVENT_MODES } from "./constants.js";

/** ---- 採点項目 ---- */
export const scoringCriterionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number(),
  maxLevel: z.number(),
});
export type ScoringCriterion = z.infer<typeof scoringCriterionSchema>;

export const createCriterionInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  maxLevel: z.number().int().min(2).max(10).default(4),
});
export type CreateCriterionInput = z.infer<typeof createCriterionInput>;

export const updateCriterionInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  maxLevel: z.number().int().min(2).max(10).optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateCriterionInput = z.infer<typeof updateCriterionInput>;

/** ---- 採点 ---- */
export const scoreSchema = z.object({
  entryId: z.string(),
  criterionId: z.string(),
  value: z.number(),
});
export type Score = z.infer<typeof scoreSchema>;

export const putScoreInput = z.object({
  entryId: z.string(),
  criterionId: z.string(),
  value: z.number().int().min(1).max(10),
});
export type PutScoreInput = z.infer<typeof putScoreInput>;

/** 集計: Entry ごとの合計と項目別合計（レーダーチャート用） */
export const entryScoreSummary = z.object({
  entryId: z.string(),
  entryName: z.string(),
  total: z.number(),
  judgeCount: z.number(),
  perCriterion: z.record(z.string(), z.number()), // criterionId -> 合計
});
export type EntryScoreSummary = z.infer<typeof entryScoreSummary>;

export const scoreSummarySchema = z.object({
  criteria: z.array(scoringCriterionSchema),
  entries: z.array(entryScoreSummary),
});
export type ScoreSummary = z.infer<typeof scoreSummarySchema>;

/** 進捗: 採点者ごとの入力状況 */
export const judgeProgress = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.string(),
  filled: z.number(),
  total: z.number(),
  complete: z.boolean(),
});
export type JudgeProgress = z.infer<typeof judgeProgress>;

export const scoreProgressSchema = z.object({
  judges: z.array(judgeProgress),
});
export type ScoreProgress = z.infer<typeof scoreProgressSchema>;

/** ---- イベント状態 ---- */
export const eventStateSchema = z.object({
  eventId: z.string(),
  mode: z.enum(EVENT_MODES),
  presentingEntryId: z.string().nullable(),
  scoringLocked: z.boolean(),
  awardsRevealCursor: z.number().nullable(),
  updatedAt: z.number(),
});
export type EventState = z.infer<typeof eventStateSchema>;

export const setModeInput = z.object({
  mode: z.enum(EVENT_MODES),
});
export type SetModeInput = z.infer<typeof setModeInput>;

export const setPresentingInput = z.object({
  presentingEntryId: z.string().nullable(),
});
export type SetPresentingInput = z.infer<typeof setPresentingInput>;
