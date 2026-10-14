import { z } from "zod";
import { EVENT_STATUSES, EVENT_VISIBILITIES } from "./constants.js";

/** イベントの共催コミュニティ (#625)。
 *
 * 主催は event.communityId のまま。共催は**表示と共催側コミュニティページの一覧
 * への掲載だけ**に効き、運営の権限・閲覧資格・KPI・所属の集計には一切効かない。
 * 共催先の owner/admin が承認したときに成立する（無断でぶら下げないため #264）。 */

export const EVENT_COHOST_STATUSES = ["pending", "accepted"] as const;
export type EventCohostStatus = (typeof EVENT_COHOST_STATUSES)[number];

/** 共催を申請する相手。コミュニティの slug（画面では URL も受け付け、サーバーで slug に直す） */
export const createCohostInput = z.object({
  slug: z.string().min(1).max(64),
});
export type CreateCohostInput = z.infer<typeof createCohostInput>;

/** イベントの運営から見た共催の1件（承認待ちを含む） */
export const eventCohostSchema = z.object({
  communityId: z.string(),
  slug: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
  status: z.enum(EVENT_COHOST_STATUSES),
  createdAt: z.number(),
  respondedAt: z.number().nullable(),
});
export type EventCohost = z.infer<typeof eventCohostSchema>;

/** 共催先コミュニティの owner/admin から見た1件（依頼中・共催中）。
 * 承諾するかを決めるのに要る範囲（題名・主催・日時・公開範囲）だけを返す */
export const communityCohostSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string(),
  /** 日程調整中なら 0 */
  eventStartsAt: z.number(),
  eventStatus: z.enum(EVENT_STATUSES),
  eventVisibility: z.enum(EVENT_VISIBILITIES),
  /** 主催コミュニティ名（主催が無いイベントは null） */
  hostCommunityName: z.string().nullable(),
  status: z.enum(EVENT_COHOST_STATUSES),
  createdAt: z.number(),
  respondedAt: z.number().nullable(),
});
export type CommunityCohost = z.infer<typeof communityCohostSchema>;
