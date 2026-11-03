import { z } from "zod";

/** スライドの基準サイズ（16:9）。要素座標はこのピクセル系で保持し、表示時に拡縮する */
export const DECK_W = 960;
export const DECK_H = 540;

export const DECK_ELEMENT_TYPES = ["text", "image"] as const;

export const deckElementSchema = z.object({
  id: z.string().max(64),
  type: z.enum(DECK_ELEMENT_TYPES),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number().default(0),
  /** 同じ groupId の要素はまとめて選択・移動される */
  groupId: z.string().max(64).optional(),
  // text
  text: z.string().max(10000).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  // image
  src: z.string().max(500).optional(),
});
export type DeckElement = z.infer<typeof deckElementSchema>;

export const deckSlideSchema = z.object({
  id: z.string().max(64),
  background: z.string().max(50).default("#ffffff"),
  elements: z.array(deckElementSchema).max(200).default([]),
});
export type DeckSlide = z.infer<typeof deckSlideSchema>;

export const deckContentSchema = z.object({
  slides: z.array(deckSlideSchema).max(300).default([]),
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
  /** 保存のたびに 1 進む版。編集画面は読み込んだ版を添えて保存し、その間にほかの人が
   * 保存していたら 409（deck_conflict）で止まる (docs/team-participation.md「チームのスライド」) */
  revision: z.number().optional(),
  /** チームのスライドなら結び付いたチーム。編集用の取得でだけ返す（公開の閲覧では返さない） */
  team: z.object({ entryId: z.string(), eventId: z.string(), name: z.string() }).nullable().optional(),
  /** 最後に保存した人。編集用の取得でだけ返す */
  lastSavedBy: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});
export type Deck = z.infer<typeof deckSchema>;

/** チームのスライドの状態（そのチームのメンバーと運営だけが取れる） */
export const teamDeckInfoSchema = z.object({
  deck: z.object({ id: z.string(), slug: z.string(), title: z.string(), updatedAt: z.number() }).nullable(),
  /** このチームのいまのメンバー（＝編集できる人）か。運営は見るだけ */
  canEdit: z.boolean(),
});
export type TeamDeckInfo = z.infer<typeof teamDeckInfoSchema>;

/** 一覧用の軽量サマリ */
export const deckSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  slideCount: z.number(),
  updatedAt: z.number(),
  /** チームのスライドなら、そのチームとイベント（一覧の「チーム: ○○」表示） */
  team: z.object({ entryId: z.string(), eventId: z.string(), name: z.string(), eventTitle: z.string() }).nullable().optional(),
});
export type DeckSummary = z.infer<typeof deckSummarySchema>;

export const createDeckInput = z.object({
  title: z.string().trim().max(120).default(""),
});
export type CreateDeckInput = z.infer<typeof createDeckInput>;

export const updateDeckInput = z.object({
  title: z.string().trim().max(120).optional(),
  content: deckContentSchema.optional(),
  /** 読み込んだ（最後に保存できた）版。添えると、その間にほかの人が保存していたら 409 */
  baseRevision: z.number().int().min(0).optional(),
});
export type UpdateDeckInput = z.infer<typeof updateDeckInput>;
