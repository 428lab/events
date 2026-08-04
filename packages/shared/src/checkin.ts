import { z } from "zod";
import { EVENT_ROLES } from "./constants.js";

/** ---- QR受付（入場チェックイン） (#154) ---- */

/**
 * member-lookup の handle。
 * username（半角英数と _ . -、2〜32文字）または UUID（36文字）を許可する。
 * username の文字種は users.ts の updateUsernameInput と揃えること。
 */
export const memberLookupQuery = z.object({
  handle: z
    .string()
    .trim()
    .regex(/^(?:[A-Za-z0-9_.-]{2,32}|[0-9a-fA-F-]{36})$/),
});
export type MemberLookupQuery = z.infer<typeof memberLookupQuery>;

/** 受付画面に返すユーザーの最小情報（PII を増やさない） */
export const checkinUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  /** 表示名（globalName ?? username） */
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type CheckinUser = z.infer<typeof checkinUserSchema>;

/** このイベントでのメンバーシップ（受付に必要な最小限） */
export const checkinMemberSchema = z.object({
  role: z.enum(EVENT_ROLES),
  status: z.string(),
  attended: z.boolean(),
});
export type CheckinMember = z.infer<typeof checkinMemberSchema>;

/** GET /api/events/:id/member-lookup のレスポンス */
export interface MemberLookupResult {
  found: boolean;
  user?: CheckinUser;
  /** このイベントのメンバーでなければ null */
  member?: CheckinMember | null;
}

/** GET /api/events/:id/my-ticket のレスポンス（署名付き・短寿命の入場チケット） */
export interface CheckinTicket {
  /** `evt1.<eventId>.<userId>.<exp>.<sig>` 形式のトークン。QR に載せる */
  token: string;
  /** 有効期限（epoch ミリ秒） */
  expiresAt: number;
}

/** POST /api/events/:id/checkin の入力 */
export const checkinInput = z.object({
  token: z.string().min(10).max(512),
});
export type CheckinInput = z.infer<typeof checkinInput>;

export type CheckinResultKind = "checked_in" | "already" | "not_confirmed";

/** POST /api/events/:id/checkin のレスポンス */
export interface CheckinResult {
  result: CheckinResultKind;
  user: CheckinUser;
  member: CheckinMember | null;
}
