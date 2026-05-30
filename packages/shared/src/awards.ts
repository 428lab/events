import { z } from "zod";
import { scoringCriterionSchema } from "./scoring.js";

export const awardRankSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string(),
  content: z.string().nullable(),
  rankOrder: z.number(),
});
export type AwardRank = z.infer<typeof awardRankSchema>;

export const specialAwardSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string(),
  content: z.string().nullable(),
  sortOrder: z.number(),
});
export type SpecialAward = z.infer<typeof specialAwardSchema>;

export const createAwardRankInput = z.object({
  name: z.string().min(1).max(100),
  content: z.string().max(500).optional().nullable(),
});
export type CreateAwardRankInput = z.infer<typeof createAwardRankInput>;

export const updateAwardRankInput = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().max(500).optional().nullable(),
  rankOrder: z.number().int().optional(),
});
export type UpdateAwardRankInput = z.infer<typeof updateAwardRankInput>;

export const createSpecialAwardInput = z.object({
  name: z.string().min(1).max(100),
  content: z.string().max(500).optional().nullable(),
});
export type CreateSpecialAwardInput = z.infer<typeof createSpecialAwardInput>;

export const updateSpecialAwardInput = z.object({
  name: z.string().min(1).max(100).optional(),
  content: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
});
export type UpdateSpecialAwardInput = z.infer<typeof updateSpecialAwardInput>;

/** 受賞割当（ランク賞 or 特別枠に entry を設定） */
export const setAwardResultInput = z.object({
  entryId: z.string().nullable(),
  awardRankId: z.string().optional().nullable(),
  specialAwardId: z.string().optional().nullable(),
});
export type SetAwardResultInput = z.infer<typeof setAwardResultInput>;

/** 集計値付きの受賞結果 */
export const awardResultViewSchema = z.object({
  id: z.string(),
  entryId: z.string(),
  entryName: z.string(),
  awardRankId: z.string().nullable(),
  specialAwardId: z.string().nullable(),
  total: z.number(),
  perCriterion: z.record(z.string(), z.number()),
});
export type AwardResultView = z.infer<typeof awardResultViewSchema>;

export const awardsViewSchema = z.object({
  ranks: z.array(awardRankSchema),
  specials: z.array(specialAwardSchema),
  criteria: z.array(scoringCriterionSchema),
  results: z.array(awardResultViewSchema),
});
export type AwardsView = z.infer<typeof awardsViewSchema>;
