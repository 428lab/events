import { z } from "zod";
import { EVENT_VISIBILITIES, VENUE_TYPES } from "./constants.js";

/**
 * AI アシスタント向けの API 面 `/api/ai/v1` (#581)。設計は docs/ai-integration.md §5。
 *
 * ここの zod は REST の入力検証と、MCP ツール（PR3）の inputSchema の両方に使う。
 * 日時は AI が epoch ms の桁を誤りやすいので ISO 8601 で受ける（§5.3）。
 */

/** イベントの作成経路（event.created_via）。画面は 'web'、create_event は 'ai' */
export const EVENT_CREATED_VIA = ["web", "ai"] as const;
export type EventCreatedVia = (typeof EVENT_CREATED_VIA)[number];

/** create_event の頻度制限（1ユーザー・1時間あたり。§4.6） */
export const AI_CREATE_EVENT_LIMIT_PER_HOUR = 10;
/** 一覧の件数の上限（§4.6） */
export const AI_LIST_LIMIT_MAX = 20;
/** get_event が返す説明文の最大文字数（§5.2。超えたら切って descriptionTruncated） */
export const AI_EVENT_DESCRIPTION_MAX = 4000;

const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** ISO 8601 の日時を epoch ms にする。時差（Z か ±hh:mm）必須。
 * 2月30日のような繰り上がる日付・不正値は null */
export function isoToEpochMs(value: string): number | null {
  const m = ISO_DATETIME.exec(value);
  if (!m) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  // Date.parse は 2026-02-30 を 3月2日に繰り上げるので、時差を戻して元の表記と突き合わせる
  const tz = m[7]!;
  const offsetMin =
    tz === "Z" ? 0 : (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)));
  const local = new Date(ms + offsetMin * 60_000).toISOString();
  const expected = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}`;
  return local.startsWith(expected) ? ms : null;
}

/** ISO 8601 の日時文字列（例 2026-11-14T19:00:00+09:00） */
export const isoDateTime = z
  .string()
  .refine((v) => isoToEpochMs(v) !== null, {
    message: "ISO 8601 datetime with timezone offset (e.g. 2026-11-14T19:00:00+09:00)",
  });

/** list_my_events（GET /api/ai/v1/me/events） */
export const aiListMyEventsInput = z.object({
  phase: z.enum(["upcoming", "past"]).default("upcoming"),
});
export type AiListMyEventsInput = z.infer<typeof aiListMyEventsInput>;

/** search_events（GET /api/ai/v1/events/search）。public.ts の searchEvents の引数に揃える */
export const aiSearchEventsInput = z.object({
  q: z.string().max(200).optional(),
  phase: z.enum(["upcoming", "scheduling", "past"]).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(AI_LIST_LIMIT_MAX).default(12),
});
export type AiSearchEventsInput = z.infer<typeof aiSearchEventsInput>;

/**
 * create_event（POST /api/ai/v1/events）。createEventInput に揃える（§5.3）。
 * 画像・参加枠・締切・status・複製元は受けない（strict で未知の項目は 400）。
 * 作るのは常に下書き。visibility の既定は unlisted（画面の既定 public と違う）
 */
export const aiCreateEventInput = z
  .object({
    title: z.string().min(1).max(200),
    subtitle: z.string().max(200).optional(),
    description: z.string().max(20000).optional(),
    /** scheduling: true のときは省略可 */
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    scheduling: z.boolean().default(false),
    scheduleAnonymous: z.boolean().default(false),
    venueType: z.enum(VENUE_TYPES),
    venueOffline: z.string().max(500).optional().nullable(),
    venueOnline: z.string().max(500).optional().nullable(),
    visibility: z.enum(EVENT_VISIBILITIES).default("unlisted"),
    communityId: z.string().nullable().optional(),
    contestMode: z.boolean().default(false),
    aggregateSelfEntry: z.boolean().default(false),
    venueWanted: z.boolean().default(false),
  })
  .strict();
export type AiCreateEventInput = z.infer<typeof aiCreateEventInput>;
