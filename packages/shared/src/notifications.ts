import { z } from "zod";

/** アプリ内通知の種別 */
export const NOTIFICATION_TYPES = [
  "lottery_won",
  "lottery_lost",
  "waitlist_promoted",
  "award",
  "inquiry_reply",
  "inquiry_new",
  "schedule_finalized",
  "request_event_created",
  "followee_created_event",
  "followee_joined_event",
  "venue_offer",
  "venue_offer_result",
  "venue_photo_result",
  "survey_reminder",
  "meet",
  /** 異常行動の検知バッチが要確認を記録したときの運営向け通知 (#259) */
  "abuse_flag",
  /** スタッフからの一斉連絡 (#172) */
  "event_broadcast",
  /** 運営スタッフへの招待が届いた (#339) */
  "staff_invite",
  /** 送った招待が承諾/辞退された（招待した本人へ） (#339) */
  "staff_invite_result",
  "info",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  /** クリック時の遷移先（アプリ内パス）。空なら遷移なし */
  link: z.string(),
  read: z.boolean(),
  createdAt: z.number(),
});
export type Notification = z.infer<typeof notificationSchema>;

/**
 * 種別の見出し。一覧 (#294) で「何の知らせか」を一目で分かるようにするためのもの。
 *
 * 通知そのものは title と body に読める文が入っているので、ここは分類のラベルに
 * とどめる（本文の言い換えにはしない）。将来 NOTIFICATION_TYPES に足りない値が
 * 入っても壊れないよう、参照側は未知の種別をラベル無しとして扱うこと。
 */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  lottery_won: "抽選",
  lottery_lost: "抽選",
  waitlist_promoted: "参加",
  award: "表彰",
  inquiry_reply: "問い合わせ",
  inquiry_new: "問い合わせ",
  schedule_finalized: "日程",
  request_event_created: "リクエスト",
  followee_created_event: "フォロー",
  followee_joined_event: "フォロー",
  venue_offer: "会場",
  venue_offer_result: "会場",
  venue_photo_result: "会場",
  survey_reminder: "アンケート",
  meet: "出会い",
  abuse_flag: "運用",
  event_broadcast: "イベントからの連絡",
  staff_invite: "運営への招待",
  staff_invite_result: "運営への招待",
  info: "お知らせ",
};

/** お知らせ一覧の1ページあたり件数 (#294)。
 * 通知は消えずに溜まり続けるので、一覧も通知ベルも必ずこの単位で区切って取る */
export const NOTIFICATION_PAGE_SIZE = 20;

/** GET /api/notifications のレスポンス */
export const notificationsPayloadSchema = z.object({
  notifications: z.array(notificationSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type NotificationsPayload = z.infer<typeof notificationsPayloadSchema>;
