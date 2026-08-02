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
  /** サブタイトル（任意・1行） */
  subtitle: z.string(),
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
  /** 所属コミュニティ（任意。無所属は null） */
  communityId: z.string().nullable(),
  /** 日程調整中（開始/終了日時は未確定。候補日に投票して主催が確定する） */
  scheduling: z.boolean(),
  /** 日程調整の回答者を匿名にする（人数のみ表示） */
  scheduleAnonymous: z.boolean(),
  /** 日程確定後も日程調整の結果を表示する（主催者がオンオフ可能） */
  scheduleVisible: z.boolean(),
  /** イベント写真を参加者以外にも公開する（主催者がオンオフ可能。既定は参加者限定） */
  photosPublic: z.boolean(),
  /** 出席チェックモード。ON なら出席チェックされた人だけが参加者扱いになる */
  attendanceCheck: z.boolean(),
  /** 短いシェアURL用スラッグ（/e/:slug） */
  slug: z.string(),
  /** 会場を探している（会場オーナーからのオファーを受け付ける） */
  venueWanted: z.boolean(),
});
export type Event = z.infer<typeof eventSchema>;

export const createEventInput = z
  .object({
    title: z.string().min(1).max(200),
    subtitle: z.string().max(200).default(""),
    description: z.string().max(20000).default(""),
    startsAt: z.number().int().default(0),
    endsAt: z.number().int().default(0),
    venueType: z.enum(VENUE_TYPES),
    venueOffline: z.string().max(500).optional().nullable(),
    venueOnline: z.string().max(500).optional().nullable(),
    aggregateSelfEntry: z.boolean().default(false),
    contestMode: z.boolean().default(false),
    communityId: z.string().nullable().optional(),
    /** 日程未定で公開（日程調整） */
    scheduling: z.boolean().default(false),
    /** 日程調整の回答者を匿名にする */
    scheduleAnonymous: z.boolean().default(false),
    /** 会場を探している */
    venueWanted: z.boolean().default(false),
  })
  .refine((v) => v.endsAt >= v.startsAt, {
    message: "endsAt must be >= startsAt",
    path: ["endsAt"],
  });
export type CreateEventInput = z.infer<typeof createEventInput>;

export const updateEventInput = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(200).optional(),
  description: z.string().max(20000).optional(),
  startsAt: z.number().int().optional(),
  endsAt: z.number().int().optional(),
  /** 日程調整をやめて日時を直接確定する（false のみ許可。true への変更は不可） */
  scheduling: z.literal(false).optional(),
  venueWanted: z.boolean().optional(),
  venueType: z.enum(VENUE_TYPES).optional(),
  venueOffline: z.string().max(500).optional().nullable(),
  venueOnline: z.string().max(500).optional().nullable(),
  aggregateSelfEntry: z.boolean().optional(),
  contestMode: z.boolean().optional(),
  status: z.enum(["draft", "published"]).optional(),
  communityId: z.string().nullable().optional(),
  scheduleAnonymous: z.boolean().optional(),
  scheduleVisible: z.boolean().optional(),
  photosPublic: z.boolean().optional(),
  attendanceCheck: z.boolean().optional(),
  /** 参加者限定の文章（確定メンバー＋staffにのみ表示。eventSchema には含めない） */
  membersNote: z.string().max(20000).optional(),
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
  /** 出席チェック済みか（出席チェックモード時に有効） */
  attended: z.boolean(),
  createdAt: z.number(),
});
export type EventMember = z.infer<typeof eventMemberSchema>;

/** 出席チェックの更新（staff） */
export const setAttendanceInput = z.object({
  attended: z.boolean(),
});
export type SetAttendanceInput = z.infer<typeof setAttendanceInput>;

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
  /** 自分が出席チェック済みか */
  attended: z.boolean(),
});
export type MyEventSummary = z.infer<typeof myEventSummary>;

export const myPageSchema = z.object({
  ongoing: z.array(myEventSummary),
  past: z.array(myEventSummary),
});
export type MyPage = z.infer<typeof myPageSchema>;
