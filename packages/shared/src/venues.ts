import { z } from "zod";

/** 会場マッチング (#53)。連絡先・非公開住所は公開APIには含めない */

export const VENUE_STATUSES = ["open", "closed"] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

/** 公開ビュー（一覧・詳細）。address は address_public のときだけ入る */
export const venueSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string(),
  area: z.string(),
  /** 詳細住所（公開設定のときのみ。非公開なら空文字） */
  address: z.string(),
  addressPublic: z.boolean(),
  capacity: z.number().nullable(),
  equipment: z.string(),
  terms: z.string(),
  status: z.enum(VENUE_STATUSES),
  imageUpdatedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type Venue = z.infer<typeof venueSchema>;

/** オーナー本人用（連絡先・非公開住所込み） */
export const venueOwnerViewSchema = venueSchema.extend({
  contact: z.string(),
});
export type VenueOwnerView = z.infer<typeof venueOwnerViewSchema>;

export const createVenueInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(4000).optional(),
  area: z.string().trim().min(1).max(100),
  address: z.string().max(300).optional(),
  addressPublic: z.boolean().optional(),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
  equipment: z.string().max(1000).optional(),
  terms: z.string().max(2000).optional(),
  contact: z.string().max(500).optional(),
});
export type CreateVenueInput = z.infer<typeof createVenueInput>;

export const updateVenueInput = createVenueInput.partial().extend({
  status: z.enum(VENUE_STATUSES).optional(),
});
export type UpdateVenueInput = z.infer<typeof updateVenueInput>;

/** カバー画像の上限（イベント画像と同等） */
export const VENUE_IMAGE = { maxBytes: 6 * 1024 * 1024 } as const;
