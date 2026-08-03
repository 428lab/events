import { z } from "zod";

/** いいねの対象種別 (#155, #160)。
 * event=イベント自体, host=主催者, staff=スタッフ各人, community=開催コミュニティ,
 * participant=参加者各人（メンバー同士の感謝。自分以外の確定参加者へ） */
export const EVENT_LIKE_KINDS = ["event", "host", "staff", "community", "participant"] as const;
export const eventLikeKind = z.enum(EVENT_LIKE_KINDS);
export type EventLikeKind = z.infer<typeof eventLikeKind>;

/** いいねのON/OFF切替入力。
 * targetKey は host/staff なら対象ユーザーID、community ならコミュニティID、event なら空文字 */
export const setEventLikeInput = z.object({
  kind: eventLikeKind,
  targetKey: z.string().default(""),
  on: z.boolean(),
});
export type SetEventLikeInput = z.infer<typeof setEventLikeInput>;

/** いいね対象ユーザー（主催者・スタッフ行の表示用。件数付き） */
export const eventLikeUserTargetSchema = z.object({
  userId: z.string(),
  username: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  count: z.number(),
});
export type EventLikeUserTarget = z.infer<typeof eventLikeUserTargetSchema>;

/** イベントのいいね集計（匿名。誰が押したかは含めない） */
export const eventLikesSummarySchema = z.object({
  /** イベント自体へのいいね数 */
  event: z.number(),
  /** 主催者（event.created_by）。ユーザー情報＋受け取ったいいね数 */
  host: eventLikeUserTargetSchema.nullable(),
  /** スタッフ各人（主催者は host 側に出すため含めない） */
  staff: z.array(eventLikeUserTargetSchema),
  /** 開催コミュニティへのいいね数（コミュニティ無しイベントは 0） */
  community: z.number(),
  /** 参加者各人（メンバー限定APIのため全メンバーに返す） */
  participants: z.array(eventLikeUserTargetSchema),
  /** 自分が押している対象の一覧（自分の状態表示用） */
  mine: z.array(z.object({ kind: eventLikeKind, targetKey: z.string() })),
});
export type EventLikesSummary = z.infer<typeof eventLikesSummarySchema>;
