import { z } from "zod";
import { userSchema } from "./schema.js";

/** 運営スタッフへの招待 (#339)。
 *
 * 運営が相手を指名し、**相手が承諾したときに初めて**運営になる。
 * 承諾前は event_member の行を持たないので、公開前イベントの中身は見えない。 */

export const STAFF_INVITE_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "revoked",
] as const;
export type StaffInviteStatus = (typeof STAFF_INVITE_STATUSES)[number];

export const STAFF_INVITE_STATUS_LABELS: Record<StaffInviteStatus, string> = {
  pending: "返事待ち",
  accepted: "承諾",
  declined: "辞退",
  revoked: "取り消し",
};

/** 招待する相手の指定。プロフィールのハンドル（@なしでも可）で指名する。
 * ユーザーIDを受け付けないのは、当てずっぽうのIDで在籍を試せる口を作らないため */
export const createStaffInviteInput = z.object({
  handle: z.string().trim().min(1).max(64),
});
export type CreateStaffInviteInput = z.infer<typeof createStaffInviteInput>;

/** 運営側から見た招待の1件（イベントの招待一覧） */
export const staffInviteSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  status: z.enum(STAFF_INVITE_STATUSES),
  createdAt: z.number(),
  respondedAt: z.number().nullable(),
  /** 招待された人 */
  user: userSchema,
  /** 招待した人（誰が誰を追加したか） */
  invitedBy: userSchema,
});
export type StaffInvite = z.infer<typeof staffInviteSchema>;

/**
 * 招待された本人から見た1件。
 *
 * **イベントの中身はここに含めない。** 承諾するかどうかを決めるのに要るのは
 * 「どのイベントの、誰からの招待か」までで、公開前イベントの説明・参加者・
 * 資料まで承諾前に見せる理由がない。開催日時は予定が合うかの判断に要るので入れる
 * （日程調整中なら 0）。
 */
export const myStaffInviteSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventTitle: z.string(),
  eventStartsAt: z.number(),
  eventEndsAt: z.number(),
  /** 公開前かどうか（承諾するまでイベントページを開けないことの説明に使う） */
  eventPublished: z.boolean(),
  invitedBy: userSchema,
  createdAt: z.number(),
});
export type MyStaffInvite = z.infer<typeof myStaffInviteSchema>;
