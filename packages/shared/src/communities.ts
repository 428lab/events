import { z } from "zod";
import { eventSchema } from "./schema.js";
import { eventRequestSchema } from "./eventRequests.js";

/** slug: 3〜32文字、英小文字/数字/ハイフン、先頭末尾は英数字 */
export const COMMUNITY_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** ルーティングと衝突するため使えない slug */
export const RESERVED_COMMUNITY_SLUGS = [
  "api",
  "c",
  "users",
  "events",
  "event",
  "communities",
  "community",
  "admin",
  "login",
  "logout",
  "me",
  "account",
  "inquiries",
  "notifications",
  "privacy",
  "terms",
  "public",
  "new",
  "edit",
  "static",
  "assets",
  "www",
  "mail",
  "og-default",
];

/** コミュニティ内ロール。owner=1人(削除/譲渡可), admin=編集/イベント管理/スタッフ任命, member=フォロワー */
export const COMMUNITY_ROLES = ["owner", "admin", "member"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

export const communityLinkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(500),
});
export type CommunityLink = z.infer<typeof communityLinkSchema>;

export const communitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  iconUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  links: z.array(communityLinkSchema),
  ownerId: z.string(),
  createdAt: z.number(),
  memberCount: z.number(),
  eventCount: z.number(),
});
export type Community = z.infer<typeof communitySchema>;

export const communityDetailSchema = communitySchema.extend({
  isMember: z.boolean(),
  isOwner: z.boolean(),
  /** 閲覧者のロール（未参加は null） */
  myRole: z.enum(COMMUNITY_ROLES).nullable(),
  upcomingEvents: z.array(eventSchema),
  pastEvents: z.array(eventSchema),
  /** イベントのたまご（オープンのみ。メンバーならメンバー限定も含む） */
  requests: z.array(eventRequestSchema),
});
export type CommunityDetail = z.infer<typeof communityDetailSchema>;

/** プロフィールの所属コミュニティ表示用 */
export const communitySummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  iconUrl: z.string().nullable(),
  role: z.enum(COMMUNITY_ROLES),
});
export type CommunitySummary = z.infer<typeof communitySummarySchema>;

export const communityMemberSchema = z.object({
  userId: z.string(),
  username: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
});
export type CommunityMember = z.infer<typeof communityMemberSchema>;

export const createCommunityInput = z.object({
  slug: z
    .string()
    .trim()
    .regex(COMMUNITY_SLUG_RE, "3〜32文字の半角英小文字・数字・ハイフン（先頭末尾は英数字）"),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(2000).default(""),
});
export type CreateCommunityInput = z.infer<typeof createCommunityInput>;

export const updateCommunityInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(2000).optional(),
  links: z.array(communityLinkSchema).max(10).optional(),
});
export type UpdateCommunityInput = z.infer<typeof updateCommunityInput>;

/** メンバーのロール変更（owner は対象外。admin↔member のみ） */
export const setCommunityRoleInput = z.object({
  role: z.enum(["admin", "member"]),
});
export type SetCommunityRoleInput = z.infer<typeof setCommunityRoleInput>;

/** オーナー譲渡（譲渡先は admin であること） */
export const transferOwnershipInput = z.object({
  toUserId: z.string(),
});
export type TransferOwnershipInput = z.infer<typeof transferOwnershipInput>;
