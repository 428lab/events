import type { AdminStats, EventStats } from "@eventer/shared";
import { many, one, run } from "../client.js";

export const eventViewsRepo = {
  /** 1ビュー記録（日次集計＋ユニーク） */
  async record(
    eventId: string,
    day: string,
    source: string,
    country: string,
    visitorId: string,
  ): Promise<void> {
    await run(
      `INSERT INTO event_view_stat (event_id, day, source, country, views)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(event_id, day, source, country)
       DO UPDATE SET views = views + 1`,
      eventId,
      day,
      source,
      country,
    );
    await run(
      `INSERT OR IGNORE INTO event_view_unique (event_id, day, visitor_id)
       VALUES (?, ?, ?)`,
      eventId,
      day,
      visitorId,
    );
  },

  /** イベントの統計（sinceDay 以降。'0000' で全期間） */
  async statsForEvent(eventId: string, sinceDay: string): Promise<EventStats> {
    const total = await one<{ v: number }>(
      "SELECT COALESCE(SUM(views),0) AS v FROM event_view_stat WHERE event_id = ? AND day >= ?",
      eventId,
      sinceDay,
    );
    const uniq = await one<{ v: number }>(
      "SELECT COUNT(DISTINCT visitor_id) AS v FROM event_view_unique WHERE event_id = ? AND day >= ?",
      eventId,
      sinceDay,
    );
    const dailyViews = await many<{ day: string; views: number }>(
      "SELECT day, SUM(views) AS views FROM event_view_stat WHERE event_id = ? AND day >= ? GROUP BY day ORDER BY day",
      eventId,
      sinceDay,
    );
    const dailyUniq = await many<{ day: string; uniques: number }>(
      "SELECT day, COUNT(*) AS uniques FROM event_view_unique WHERE event_id = ? AND day >= ? GROUP BY day",
      eventId,
      sinceDay,
    );
    const uniqByDay = new Map(dailyUniq.map((r) => [r.day, r.uniques]));
    // 参加登録（確定メンバー）の総数と日別（created_at を JST 日付に）
    const partTotal = await one<{ v: number }>(
      "SELECT COUNT(*) AS v FROM event_member WHERE event_id = ? AND status = 'confirmed'",
      eventId,
    );
    const dailyJoins = await many<{ day: string; joins: number }>(
      `SELECT strftime('%Y-%m-%d', created_at / 1000 + 32400, 'unixepoch') AS day,
              COUNT(*) AS joins
       FROM event_member
       WHERE event_id = ? AND status = 'confirmed'
       GROUP BY day HAVING day >= ?`,
      eventId,
      sinceDay,
    );
    const joinsByDay = new Map(dailyJoins.map((r) => [r.day, r.joins]));
    // 表示があった日＋参加があった日の和集合で日次を構成
    const allDays = [
      ...new Set([...dailyViews.map((r) => r.day), ...joinsByDay.keys()]),
    ].sort();
    const viewsByDay = new Map(dailyViews.map((r) => [r.day, r.views]));
    const sources = await many<{ source: string; views: number }>(
      "SELECT source, SUM(views) AS views FROM event_view_stat WHERE event_id = ? AND day >= ? GROUP BY source ORDER BY views DESC LIMIT 15",
      eventId,
      sinceDay,
    );
    const countries = await many<{ country: string; views: number }>(
      "SELECT country, SUM(views) AS views FROM event_view_stat WHERE event_id = ? AND day >= ? GROUP BY country ORDER BY views DESC LIMIT 15",
      eventId,
      sinceDay,
    );
    return {
      totalViews: total?.v ?? 0,
      uniqueVisitors: uniq?.v ?? 0,
      totalParticipants: partTotal?.v ?? 0,
      daily: allDays.map((day) => ({
        day,
        views: viewsByDay.get(day) ?? 0,
        uniques: uniqByDay.get(day) ?? 0,
        joins: joinsByDay.get(day) ?? 0,
      })),
      sources,
      countries,
    };
  },

  /** 管理者向け: 全イベント横断（views降順） */
  async adminOverview(): Promise<AdminStats> {
    const total = await one<{ v: number }>(
      "SELECT COALESCE(SUM(views),0) AS v FROM event_view_stat",
    );
    const rows = await many<{ event_id: string; title: string; views: number }>(
      `SELECT s.event_id, e.title, SUM(s.views) AS views
       FROM event_view_stat s JOIN event e ON e.id = s.event_id
       GROUP BY s.event_id ORDER BY views DESC LIMIT 100`,
    );
    const uniqRows = await many<{ event_id: string; uniques: number }>(
      "SELECT event_id, COUNT(DISTINCT visitor_id) AS uniques FROM event_view_unique GROUP BY event_id",
    );
    const uniqById = new Map(uniqRows.map((r) => [r.event_id, r.uniques]));
    return {
      totalViews: total?.v ?? 0,
      events: rows.map((r) => ({
        eventId: r.event_id,
        title: r.title,
        views: r.views,
        uniques: uniqById.get(r.event_id) ?? 0,
      })),
    };
  },
};
