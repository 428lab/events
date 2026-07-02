import { z } from "zod";

export const VOTE_CHOICES = ["yes", "maybe", "no"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export const dateOptionSchema = z.object({
  id: z.string(),
  startsAt: z.number(),
  endsAt: z.number(),
  counts: z.object({ yes: z.number(), maybe: z.number(), no: z.number() }),
  /** 各回答者の選択（表示用） */
  voters: z.array(
    z.object({
      userId: z.string(),
      username: z.string(),
      name: z.string(),
      avatarUrl: z.string().nullable(),
      choice: z.enum(VOTE_CHOICES),
    }),
  ),
});
export type DateOption = z.infer<typeof dateOptionSchema>;

export const scheduleViewSchema = z.object({
  options: z.array(dateOptionSchema),
  /** 閲覧者自身の回答（optionId → choice） */
  myVotes: z.record(z.string(), z.enum(VOTE_CHOICES)),
  /** 回答者を匿名にする（true のとき voters は常に空） */
  anonymous: z.boolean(),
});
export type ScheduleView = z.infer<typeof scheduleViewSchema>;

export const addDateOptionInput = z
  .object({
    startsAt: z.number().int(),
    endsAt: z.number().int(),
  })
  .refine((v) => v.endsAt >= v.startsAt, {
    message: "endsAt must be >= startsAt",
    path: ["endsAt"],
  });
export type AddDateOptionInput = z.infer<typeof addDateOptionInput>;

export const voteInput = z.object({ choice: z.enum(VOTE_CHOICES) });
export type VoteInput = z.infer<typeof voteInput>;

export const finalizeDateInput = z.object({ optionId: z.string() });
export type FinalizeDateInput = z.infer<typeof finalizeDateInput>;
