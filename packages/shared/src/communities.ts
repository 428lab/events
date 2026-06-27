import { z } from "zod";
import { eventSchema } from "./schema.js";

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

export const communitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  iconUrl: z.string().nullable(),
  ownerId: z.string(),
  createdAt: z.number(),
  memberCount: z.number(),
  eventCount: z.number(),
});
export type Community = z.infer<typeof communitySchema>;

export const communityDetailSchema = communitySchema.extend({
  isMember: z.boolean(),
  isOwner: z.boolean(),
  upcomingEvents: z.array(eventSchema),
  pastEvents: z.array(eventSchema),
});
export type CommunityDetail = z.infer<typeof communityDetailSchema>;

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
});
export type UpdateCommunityInput = z.infer<typeof updateCommunityInput>;
