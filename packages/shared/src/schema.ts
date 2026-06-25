import { z } from "zod";
import {
  EVENT_ROLES,
  EVENT_STATUSES,
  PARTICIPATION_TYPES,
  VENUE_TYPES,
} from "./constants.js";

const url = z.string().url();
const optionalUrl = z.union([url, z.literal("")]).optional().nullable();

/** ---- User ---- */
export const userSchema = z.object({
  id: z.string(),
  discordId: z.string(),
  username: z.string(),
  globalName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.number(),
});
export type User = z.infer<typeof userSchema>;

/** ---- Event ---- */
export const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  startsAt: z.number(),
  endsAt: z.number(),
  venueType: z.enum(VENUE_TYPES),
  venueOffline: z.string().nullable(),
  venueOnline: z.string().nullable(),
  participationType: z.enum(PARTICIPATION_TYPES),
  aggregateSelfEntry: z.boolean(),
  /** コンテスト形式（採点・成果物・表彰などを使う）。オフ＝告知/募集のみの一般イベント */
  contestMode: z.boolean(),
  status: z.enum(EVENT_STATUSES),
  createdBy: z.string(),
  createdAt: z.number(),
  imageUpdatedAt: z.number().nullable(),
  participantCount: z.number(),
});
export type Event = z.infer<typeof eventSchema>;

export const createEventInput = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().default(""),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    venueType: z.enum(VENUE_TYPES),
    venueOffline: z.string().max(500).optional().nullable(),
    venueOnline: z.string().max(500).optional().nullable(),
    aggregateSelfEntry: z.boolean().default(false),
    contestMode: z.boolean().default(false),
  })
  .refine((v) => v.endsAt >= v.startsAt, {
    message: "endsAt must be >= startsAt",
    path: ["endsAt"],
  });
export type CreateEventInput = z.infer<typeof createEventInput>;

export const updateEventInput = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  startsAt: z.number().int().optional(),
  endsAt: z.number().int().optional(),
  venueType: z.enum(VENUE_TYPES).optional(),
  venueOffline: z.string().max(500).optional().nullable(),
  venueOnline: z.string().max(500).optional().nullable(),
  aggregateSelfEntry: z.boolean().optional(),
  contestMode: z.boolean().optional(),
  status: z.enum(["draft", "published"]).optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventInput>;

/** ---- Membership ---- */
export const eventMemberSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  role: z.enum(EVENT_ROLES),
  slotId: z.string().nullable(),
  status: z.string(),
  createdAt: z.number(),
});
export type EventMember = z.infer<typeof eventMemberSchema>;

export const eventMemberWithUser = eventMemberSchema.extend({
  user: userSchema,
});
export type EventMemberWithUser = z.infer<typeof eventMemberWithUser>;

export const updateMemberRoleInput = z.object({
  role: z.enum(EVENT_ROLES),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInput>;

/** ---- Entry / Submission ---- */
export const submissionSchema = z.object({
  presentationUrl: z.string().nullable(),
  sourceCodeUrl: z.string().nullable(),
  updatedAt: z.number().nullable(),
});
export type Submission = z.infer<typeof submissionSchema>;

export const entrySchema = z.object({
  id: z.string(),
  eventId: z.string(),
  kind: z.string(),
  name: z.string(),
  teamId: z.string().nullable(),
  presentationOrder: z.number().nullable(),
  createdAt: z.number(),
  memberUserIds: z.array(z.string()),
  submission: submissionSchema.nullable(),
});
export type Entry = z.infer<typeof entrySchema>;

export const updateSubmissionInput = z.object({
  presentationUrl: optionalUrl,
  sourceCodeUrl: optionalUrl,
});
export type UpdateSubmissionInput = z.infer<typeof updateSubmissionInput>;

/** ---- My page ---- */
export const myEventSummary = eventSchema.extend({
  myRole: z.enum(EVENT_ROLES),
});
export type MyEventSummary = z.infer<typeof myEventSummary>;

export const myPageSchema = z.object({
  ongoing: z.array(myEventSummary),
  past: z.array(myEventSummary),
});
export type MyPage = z.infer<typeof myPageSchema>;
