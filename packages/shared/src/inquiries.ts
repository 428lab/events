import { z } from "zod";

export const INQUIRY_STATUSES = ["open", "answered", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** 1人が1つのイベントへ出せる、未完了（closed 以外）の問い合わせの数 (D-EVENT-CONTACT) */
export const EVENT_INQUIRY_OPEN_LIMIT = 3;

/** 問い合わせの書き手。user=問い合わせた人、admin=アプリ運営（運営あての問い合わせ）、
 * staff=そのイベントの確定スタッフ（イベントの主催者あての問い合わせ。D-EVENT-CONTACT） */
export const INQUIRY_SENDERS = ["user", "admin", "staff"] as const;
export type InquirySender = (typeof INQUIRY_SENDERS)[number];

/** イベントの主催者あての問い合わせが指すイベント。運営あてなら null。
 * 問い合わせた人がそのイベントを見られなくなったら（非公開イベントの閲覧を外された等）null で返す */
export const inquiryEventSchema = z.object({ id: z.string(), title: z.string() });
export type InquiryEvent = z.infer<typeof inquiryEventSchema>;

/** 一覧用の問い合わせサマリ */
export const inquirySchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(INQUIRY_STATUSES),
  createdAt: z.number(),
  lastMessageAt: z.number(),
  lastSender: z.enum(INQUIRY_SENDERS),
  /** その閲覧者にとって未読か（ユーザー視点 or 運営・主催者視点） */
  unread: z.boolean(),
  event: inquiryEventSchema.nullable(),
});
export type Inquiry = z.infer<typeof inquirySchema>;

/** 運営一覧・イベントの主催者側の一覧用に作成者情報を付与 */
export const adminInquirySchema = inquirySchema.extend({
  userId: z.string(),
  /** プロフィールURL用のハンドル（username） */
  userHandle: z.string(),
  userName: z.string(),
  userAvatarUrl: z.string().nullable(),
});
export type AdminInquiry = z.infer<typeof adminInquirySchema>;

export const inquiryMessageSchema = z.object({
  id: z.string(),
  sender: z.enum(INQUIRY_SENDERS),
  body: z.string(),
  createdAt: z.number(),
});
export type InquiryMessage = z.infer<typeof inquiryMessageSchema>;

export const inquiryDetailSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(INQUIRY_STATUSES),
  messages: z.array(inquiryMessageSchema),
  event: inquiryEventSchema.nullable(),
  /** 運営・主催者視点の詳細でのみ付与される投稿者情報 */
  userId: z.string().optional(),
  userHandle: z.string().optional(),
  userName: z.string().optional(),
  userAvatarUrl: z.string().nullable().optional(),
});
export type InquiryDetail = z.infer<typeof inquiryDetailSchema>;

export const createInquiryInput = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});
export type CreateInquiryInput = z.infer<typeof createInquiryInput>;

/** イベントの主催者への問い合わせ (D-EVENT-CONTACT)。件名は任意（空なら画面でイベント名を出す） */
export const createEventInquiryInput = z.object({
  subject: z.string().max(200).default(""),
  body: z.string().min(1).max(5000),
});
export type CreateEventInquiryInput = z.infer<typeof createEventInquiryInput>;

export const postInquiryMessageInput = z.object({
  body: z.string().min(1).max(5000),
});
export type PostInquiryMessageInput = z.infer<typeof postInquiryMessageInput>;
