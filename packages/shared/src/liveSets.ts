import { z } from "zod";
import { DECK_H, DECK_W } from "./decks.js";

/** 配信画面の基準サイズ。デッキと同じ座標系（16:9）を使い、表示時に拡縮する */
export const LIVE_W = DECK_W;
export const LIVE_H = DECK_H;

/** 配信画面タブが状態をポーリングする間隔 */
export const LIVE_POLL_MS = 1000;

export const LIVE_ELEMENT_TYPES = [
  "text",
  "image",
  "camera",
  "deck",
  "eventInfo", "shape", "motif", "marquee", "clock", "countdown", "liveIndicator",
] as const;
export type LiveElementType = (typeof LIVE_ELEMENT_TYPES)[number];

/** eventInfo 要素が表示できるイベント情報 */
export const EVENT_INFO_FIELDS = [
  "title",
  "datetime",
  "participants",
  "community",
] as const;
export type EventInfoField = (typeof EVENT_INFO_FIELDS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const rotationMotion = z.object({ kind: z.literal("rotation"), seconds: z.number().min(12).max(60), direction: z.enum(["clockwise", "counterclockwise"]) });
const colorMotion = z.object({ kind: z.literal("colorCycle"), seconds: z.number().min(8).max(30), colors: z.array(hex).min(2).max(4) });

export const liveElementSchema = z.object({
  id: z.string().max(64),
  type: z.enum(LIVE_ELEMENT_TYPES),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number().default(0),
  // text / eventInfo
  text: z.string().max(2000).optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  // image
  src: z.string().max(500).optional(),
  // camera: 表示のフィット方法（cover=枠いっぱい/contain=全体表示）
  fit: z.enum(["cover", "contain"]).optional(),
  /** camera: 角丸(px)。丸抜きPinP用 */
  radius: z.number().optional(),
  // eventInfo
  field: z.enum(EVENT_INFO_FIELDS).optional(),
  /** Hide a composed date card when the actual event schedule has not been fixed. */
  requiresEventDatetime: z.boolean().optional(),
  // Only predeclared decorative primitives and bounded effects; never user CSS/HTML.
  shape: z.enum(["rectangle", "ellipse", "line"]).optional(),
  motif: z.enum(["lantern", "halo", "brackets", "grid", "ticks"]).optional(),
  fill: hex.optional(),
  stroke: hex.optional(),
  strokeWidth: z.number().min(0).max(16).optional(),
  opacity: z.number().min(0).max(1).optional(),
  motion: z.discriminatedUnion("kind", [rotationMotion, colorMotion]).optional(),
  seconds: z.number().min(12).max(40).optional(),
  gap: z.number().min(24).max(64).optional(),
  direction: z.enum(["left", "right"]).optional(),
  timezone: z.string().min(1).max(64).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }).optional(),
  hour12: z.boolean().optional(),
  showSeconds: z.boolean().optional(),
  showDate: z.boolean().optional(),
  target: z.enum(["eventStart", "custom"]).optional(),
  /** An unconfirmed custom target is saved without an epoch; the runtime hides it. */
  targetEpochMs: z.number().int().min(0).max(8640000000000000).optional(),
  zero: z.enum(["stop", "hide"]).optional(),
}).superRefine((el, ctx) => {
  if (el.motion && !((el.type === "motif" && el.motion.kind === "rotation") || ((el.type === "shape" || el.type === "motif") && el.motion.kind === "colorCycle"))) ctx.addIssue({ code: "custom", message: "decorative motion only" });
  if (el.motion?.kind === "colorCycle" && (el.w > 180 || el.h > 180 || el.motion.colors.some(c => !["#FB923C", "#2DD4BF", "#FBBF24", "#7DD3FC"].includes(c)))) ctx.addIssue({ code: "custom", message: "Only small ornaments and legible palette colors can cycle" });
  if (["shape", "motif", "marquee", "clock", "countdown", "liveIndicator"].includes(el.type) && (el.x < -960 || el.x > 960 || el.y < -540 || el.y > 540 || el.w < 1 || el.w > 960 || el.h < 1 || el.h > 540)) ctx.addIssue({ code: "custom", message: "Invalid visual bounds" });
  if (el.type === "motif" && !el.motif || el.type === "shape" && !el.shape) ctx.addIssue({ code: "custom", message: "primitive required" });
  if (el.type === "marquee" && (el.text?.length ?? 0) > 120) ctx.addIssue({ code: "custom", message: "marquee too long" });
  if (el.type === "liveIndicator" && (el.text?.length ?? 0) > 32) ctx.addIssue({ code: "custom", message: "badge text too long" });
  if (["clock", "countdown", "marquee", "liveIndicator"].includes(el.type) && el.fontSize !== undefined && (el.fontSize < 16 || el.fontSize > 72)) ctx.addIssue({ code: "custom", message: "Invalid widget font size" });
});
export type LiveElement = z.infer<typeof liveElementSchema>;

export const liveSceneSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(100),
  background: z.string().max(200).default("#0E1426"),
  /** このシーンに切り替えたときのBGM。
   * undefined=変更しない / null=停止 / trackId=その曲を再生 */
  bgmTrackId: z.string().max(64).nullable().optional(),
  elements: z.array(liveElementSchema).max(50).default([]),
}).refine(scene => scene.elements.filter(el => el.motion).length <= 2, { message: "Only two decorative effects can run in one scene" });
export type LiveScene = z.infer<typeof liveSceneSchema>;

export const liveSetContentSchema = z.object({
  scenes: z.array(liveSceneSchema).max(50).default([]),
});
export type LiveSetContent = z.infer<typeof liveSetContentSchema>;

export const liveSetSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  communityId: z.string().nullable(),
  name: z.string(),
  content: liveSetContentSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type LiveSet = z.infer<typeof liveSetSchema>;

export const liveSetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  sceneCount: z.number(),
  updatedAt: z.number(),
});
export type LiveSetSummary = z.infer<typeof liveSetSummarySchema>;

export const createLiveSetInput = z.object({
  name: z.string().trim().max(120).default(""),
  /** ベースにする既存セット（自分のセットのみ）。未指定はビルトインテンプレ */
  baseLiveSetId: z.string().optional(),
  templateId: z.enum(["glow", "signal"]).optional(),
}).refine(v => !(v.baseLiveSetId && v.templateId), { message: "Cannot combine template and clone" });
export type CreateLiveSetInput = z.infer<typeof createLiveSetInput>;

export const updateLiveSetInput = z.object({
  /** New editors send the last persisted revision; old tabs cannot erase new primitives. */
  baseUpdatedAt: z.number().int().nonnegative().optional(),
  name: z.string().trim().max(120).optional(),
  content: liveSetContentSchema.optional(),
  communityId: z.string().nullable().optional(),
});
export type UpdateLiveSetInput = z.infer<typeof updateLiveSetInput>;

/** ---- イベント配信状態（コントロール→画面の同期点） ---- */

export const eventLiveStateSchema = z.object({
  eventId: z.string(),
  liveSetId: z.string().nullable(),
  activeSceneId: z.string().nullable(),
  deckId: z.string().nullable(),
  deckPage: z.number(),
  bgmTrackId: z.string().nullable(),
  bgmPlaying: z.boolean(),
  bgmVolume: z.number(),
  liveIndicatorOn: z.boolean(),
  updatedAt: z.number(),
});
export type EventLiveState = z.infer<typeof eventLiveStateSchema>;

export const updateEventLiveStateInput = z.object({
  liveSetId: z.string().nullable().optional(),
  activeSceneId: z.string().nullable().optional(),
  deckId: z.string().nullable().optional(),
  deckPage: z.number().int().min(0).optional(),
  bgmTrackId: z.string().nullable().optional(),
  bgmPlaying: z.boolean().optional(),
  bgmVolume: z.number().min(0).max(1).optional(),
  liveIndicatorOn: z.boolean().optional(),
});
export type UpdateEventLiveStateInput = z.infer<typeof updateEventLiveStateInput>;

/** ---- BGM ---- */

export const bgmTrackSchema = z.object({
  id: z.string(),
  /** null はビルトイン曲 */
  ownerId: z.string().nullable(),
  name: z.string(),
  /** YouTube概要欄などに貼るクレジット表記（出典・ライセンス） */
  creditText: z.string(),
  createdAt: z.number(),
});
export type BgmTrack = z.infer<typeof bgmTrackSchema>;

export const BGM_MAX_BYTES = 8 * 1024 * 1024; // bodyLimit と同じ8MB

/** ---- デフォルトテンプレート ----
 * ゼロ設定でも配信できるよう、新規セット作成時にこのシーン一式を複製する。
 * イベントで配信セット未選択のときも読み取り専用の既定セットとして使うため、
 * ID は固定（毎回同じ）にしてポーリング間で安定させる。
 * 色は DESIGN.md（Natsumatsuri）の夜空ダーク＋提灯ティール。 */

/** イベントで配信セット未選択のとき使う仮想セットのID */
export const DEFAULT_LIVE_SET_ID = "default";

function centerText(
  id: string,
  text: string,
  opts: Partial<LiveElement> = {},
): LiveElement {
  return {
    id,
    type: "text",
    x: 80,
    y: 210,
    w: 800,
    h: 120,
    rotation: 0,
    text,
    fontSize: 48,
    color: "#EAF0F7",
    bold: true,
    align: "center",
    ...opts,
  };
}

export function defaultLiveSetContent(): LiveSetContent {
  const scenes: LiveScene[] = [
    {
      id: "tpl-wait",
      name: "開始前待機",
      background: "#0E1426",
      elements: [
        { id: "tpl-wait-title", type: "eventInfo", field: "title", x: 80, y: 160, w: 800, h: 90, rotation: 0, fontSize: 44, color: "#EAF0F7", bold: true, align: "center" },
        centerText("tpl-wait-msg", "まもなく開始します", { y: 280, fontSize: 30, color: "#2DD4BF", bold: false }),
      ],
    },
    {
      id: "tpl-op",
      name: "OP",
      background: "linear-gradient(135deg, #0B3A34 0%, #0E1426 60%)",
      elements: [
        { id: "tpl-op-title", type: "eventInfo", field: "title", x: 80, y: 180, w: 800, h: 100, rotation: 0, fontSize: 52, color: "#EAF0F7", bold: true, align: "center" },
        { id: "tpl-op-dt", type: "eventInfo", field: "datetime", x: 80, y: 300, w: 800, h: 50, rotation: 0, fontSize: 24, color: "#97A3BC", align: "center" },
      ],
    },
    {
      id: "tpl-deck",
      name: "スライド全画面",
      background: "#000000",
      elements: [
        { id: "tpl-deck-main", type: "deck", x: 0, y: 0, w: 960, h: 540, rotation: 0 },
      ],
    },
    {
      id: "tpl-deck-cam",
      name: "スライド + カメラ",
      background: "#0E1426",
      elements: [
        { id: "tpl-deck-cam-deck", type: "deck", x: 0, y: 0, w: 720, h: 405, rotation: 0 },
        { id: "tpl-deck-cam-cam", type: "camera", x: 736, y: 16, w: 208, h: 156, rotation: 0, fit: "cover", radius: 12 },
      ],
    },
    {
      id: "tpl-cam",
      name: "カメラ全画面",
      background: "#000000",
      elements: [
        { id: "tpl-cam-main", type: "camera", x: 0, y: 0, w: 960, h: 540, rotation: 0, fit: "cover" },
      ],
    },
    {
      id: "tpl-break",
      name: "休憩中",
      background: "#0E1426",
      elements: [
        centerText("tpl-break-msg", "しばらくお待ちください", { fontSize: 40 }),
        centerText("tpl-break-icon", "☕", { y: 130, fontSize: 64, bold: false }),
      ],
    },
    {
      id: "tpl-ed",
      name: "ED",
      background: "linear-gradient(135deg, #0E1426 40%, #0B3A34 100%)",
      elements: [
        centerText("tpl-ed-msg", "ご視聴ありがとうございました！", { y: 200, fontSize: 44 }),
        { id: "tpl-ed-title", type: "eventInfo", field: "title", x: 80, y: 320, w: 800, h: 50, rotation: 0, fontSize: 24, color: "#97A3BC", align: "center" },
      ],
    },
  ];
  return { scenes };
}
