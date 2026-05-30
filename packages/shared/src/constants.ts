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
