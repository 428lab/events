import { z } from "zod";

export const INQUIRY_STATUSES = ["open", "answered", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** 一覧用の問い合わせサマリ */
export const inquirySchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(INQUIRY_STATUSES),
  createdAt: z.number(),
  lastMessageAt: z.number(),
  lastSender: z.enum(["user", "admin"]),
  /** その閲覧者にとって未読か（ユーザー視点 or 運営視点） */
  unread: z.boolean(),
});
export type Inquiry = z.infer<typeof inquirySchema>;

/** 運営一覧用に作成者情報を付与 */
export const adminInquirySchema = inquirySchema.extend({
  userName: z.string(),
  userAvatarUrl: z.string().nullable(),
});
export type AdminInquiry = z.infer<typeof adminInquirySchema>;

export const inquiryMessageSchema = z.object({
  id: z.string(),
  sender: z.enum(["user", "admin"]),
  body: z.string(),
  createdAt: z.number(),
});
export type InquiryMessage = z.infer<typeof inquiryMessageSchema>;

export const inquiryDetailSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(INQUIRY_STATUSES),
  messages: z.array(inquiryMessageSchema),
  /** 運営視点の詳細でのみ付与される投稿者の表示名 */
  userName: z.string().optional(),
});
export type InquiryDetail = z.infer<typeof inquiryDetailSchema>;

export const createInquiryInput = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});
export type CreateInquiryInput = z.infer<typeof createInquiryInput>;

export const postInquiryMessageInput = z.object({
  body: z.string().min(1).max(5000),
});
export type PostInquiryMessageInput = z.infer<typeof postInquiryMessageInput>;
