import { z } from "zod";

/** イベントのアクセス統計（主催者向け） */
export const eventStatsSchema = z.object({
  totalViews: z.number(),
  uniqueVisitors: z.number(),
  /** 日次の表示数・ユニーク（日付昇順） */
  daily: z.array(
    z.object({ day: z.string(), views: z.number(), uniques: z.number() }),
  ),
  /** 流入元トップ（views降順） */
  sources: z.array(z.object({ source: z.string(), views: z.number() })),
  /** 国トップ（views降順） */
  countries: z.array(z.object({ country: z.string(), views: z.number() })),
});
export type EventStats = z.infer<typeof eventStatsSchema>;

/** 管理者向け: 全イベント横断のアクセス統計 */
export const adminStatsSchema = z.object({
  totalViews: z.number(),
  events: z.array(
    z.object({
      eventId: z.string(),
      title: z.string(),
      views: z.number(),
      uniques: z.number(),
    }),
  ),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;
