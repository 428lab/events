import { z } from "zod";
import { VENUE_TYPES } from "./constants.js";

/** ---- イベントのたまご（あったらいいなリクエスト） #29 ---- */

export const EVENT_REQUEST_STATUSES = ["open", "closed"] as const;
export type EventRequestStatus = (typeof EVENT_REQUEST_STATUSES)[number];

/** 賛同の種類: 参加したい / 開催してもいい */
export const EVENT_REQUEST_REACTIONS = ["attend", "host"] as const;
export type EventRequestReaction = (typeof EVENT_REQUEST_REACTIONS)[number];

export const eventRequestSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  /** 希望の開催形態（null = こだわらない） */
  venueTypePref: z.enum(VENUE_TYPES).nullable(),
  /** コミュニティ内リクエスト（null = 全体公開） */
  communityId: z.string().nullable(),
  /** コミュニティメンバー以外に見せない（communityId ありのときのみ有効） */
  membersOnly: z.boolean(),
  status: z.enum(EVENT_REQUEST_STATUSES),
  createdBy: z.string(),
  createdAt: z.number(),
  /** 「参加したい」の人数 */
  attendCount: z.number(),
  /** 「開催してもいい」の人数 */
  hostCount: z.number(),
  /** リンク済みイベント数（開催宣言から生まれたイベント） */
  eventCount: z.number(),
  /** 短い共有URL用スラッグ（/r/:slug） */
  slug: z.string(),
  /** 会場を探している */
  venueWanted: z.boolean(),
});
export type EventRequest = z.infer<typeof eventRequestSchema>;

export const createEventRequestInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  venueTypePref: z.enum(VENUE_TYPES).nullable().optional(),
  communityId: z.string().nullable().optional(),
  membersOnly: z.boolean().optional(),
  venueWanted: z.boolean().optional(),
});
export type CreateEventRequestInput = z.infer<typeof createEventRequestInput>;

export const reactEventRequestInput = z.object({
  kind: z.enum(EVENT_REQUEST_REACTIONS),
  /** true で賛同、false で取り消し */
  on: z.boolean(),
});
export type ReactEventRequestInput = z.infer<typeof reactEventRequestInput>;
