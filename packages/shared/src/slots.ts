import { z } from "zod";
import { MEMBER_STATUSES, SELECTION_TYPES } from "./constants.js";

/** 参加枠（定員つき・先着/抽選）。counts は集計値。 */
export const participationSlotSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string(),
  capacity: z.number(),
  selectionType: z.enum(SELECTION_TYPES),
  sortOrder: z.number(),
  drawAt: z.number().nullable(),
  confirmedCount: z.number(),
  waitlistCount: z.number(),
  appliedCount: z.number(),
});
export type ParticipationSlot = z.infer<typeof participationSlotSchema>;

export const createSlotInput = z.object({
  name: z.string().min(1).max(100),
  capacity: z.number().int().min(1).max(100000),
  selectionType: z.enum(SELECTION_TYPES).default("first_come"),
  drawAt: z.number().int().optional().nullable(),
});
export type CreateSlotInput = z.infer<typeof createSlotInput>;

export const updateSlotInput = z.object({
  name: z.string().min(1).max(100).optional(),
  capacity: z.number().int().min(1).max(100000).optional(),
  selectionType: z.enum(SELECTION_TYPES).optional(),
  sortOrder: z.number().int().optional(),
  drawAt: z.number().int().optional().nullable(),
});
export type UpdateSlotInput = z.infer<typeof updateSlotInput>;

/** 参加申込（枠を選ぶ）。枠未設定イベントでは slotId 省略可。 */
export const joinEventInput = z.object({
  slotId: z.string().optional().nullable(),
});
export type JoinEventInput = z.infer<typeof joinEventInput>;

export const memberStatusEnum = z.enum(MEMBER_STATUSES);

/** スタッフが当選操作で各申込者の状態を手動設定する入力 */
export const setMemberSlotStatusInput = z.object({
  status: memberStatusEnum,
});
export type SetMemberSlotStatusInput = z.infer<typeof setMemberSlotStatusInput>;
