import { z } from "zod";

/** スライドの基準サイズ（16:9）。要素座標はこのピクセル系で保持し、表示時に拡縮する */
export const DECK_W = 960;
export const DECK_H = 540;

export const DECK_ELEMENT_TYPES = ["text", "image"] as const;

export const deckElementSchema = z.object({
  id: z.string(),
  type: z.enum(DECK_ELEMENT_TYPES),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number().default(0),
  // text
  text: z.string().optional(),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  // image
  src: z.string().optional(),
});
export type DeckElement = z.infer<typeof deckElementSchema>;

export const deckSlideSchema = z.object({
  id: z.string(),
  background: z.string().default("#ffffff"),
  elements: z.array(deckElementSchema).default([]),
});
export type DeckSlide = z.infer<typeof deckSlideSchema>;

export const deckContentSchema = z.object({
  slides: z.array(deckSlideSchema).default([]),
});
export type DeckContent = z.infer<typeof deckContentSchema>;

export const deckSchema = z.object({
  id: z.string(),
  slug: z.string(),
  ownerId: z.string(),
  title: z.string(),
  content: deckContentSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Deck = z.infer<typeof deckSchema>;

/** 一覧用の軽量サマリ */
export const deckSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  slideCount: z.number(),
  updatedAt: z.number(),
});
export type DeckSummary = z.infer<typeof deckSummarySchema>;

export const createDeckInput = z.object({
  title: z.string().trim().max(120).default(""),
});
export type CreateDeckInput = z.infer<typeof createDeckInput>;

export const updateDeckInput = z.object({
  title: z.string().trim().max(120).optional(),
  content: deckContentSchema.optional(),
});
export type UpdateDeckInput = z.infer<typeof updateDeckInput>;
