export const EVENT_ROLES = ["participant", "staff", "judge", "observer"] as const;
export type EventRole = (typeof EVENT_ROLES)[number];

export const EVENT_MODES = ["normal", "presentation", "aggregation", "awards"] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const VENUE_TYPES = ["offline", "online", "hybrid"] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

export const PARTICIPATION_TYPES = ["individual", "team"] as const;
export type ParticipationType = (typeof PARTICIPATION_TYPES)[number];

export const EVENT_STATUSES = ["draft", "published", "archived"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ENTRY_KINDS = ["individual", "team"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** イベント管理（設定変更・ロール割当）が可能なロール */
export const EVENT_ADMIN_ROLES: readonly EventRole[] = ["staff"];

export const SELECTION_TYPES = ["first_come", "lottery"] as const;
export type SelectionType = (typeof SELECTION_TYPES)[number];

/** 参加メンバーの状態: 確定 / キャンセル待ち / 抽選申込 / 落選 / 取消済み（履歴として保持） */
export const MEMBER_STATUSES = ["confirmed", "waitlist", "applied", "lost", "canceled"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** イベント画像（OG画像サイズ 1.91:1）。クロップ先サイズと最大バイト数。 */
export const EVENT_IMAGE = {
  width: 1200,
  height: 630,
  maxBytes: 1024 * 1024, // 1MB
} as const;

/** プロフィールカードPNG（プロフィールOG画像のR2キャッシュ）。2148x1300 で概ね数百KB (#193) */
export const PROFILE_CARD_IMAGE = {
  maxBytes: 2 * 1024 * 1024, // 2MB
} as const;

export const COMMUNITY_ICON = {
  width: 512,
  height: 512,
  maxBytes: 1024 * 1024,
} as const;

export const COMMUNITY_BANNER = {
  width: 1500,
  height: 500,
  maxBytes: 1024 * 1024,
} as const;
