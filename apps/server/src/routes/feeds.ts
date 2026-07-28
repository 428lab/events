import type { Context } from "hono";
import type { Event } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { env } from "../runtime.js";
import { eventsRepo } from "../db/repositories/events.js";

/** 公開イベントのフィード（RSS / JSON Feed / iCalendar）。
 * フィルタはクエリで指定（検索APIと同じ語彙）:
 *   q, communityId, venueType, from, to(ms), sort(soon|recent|new), type(upcoming|past|scheduling), limit */

const MAX_ITEMS = 50;

/** XML 1.0 で表現不可の制御文字を除去（1件でも混ざると feed 全体が不正XMLになる） */
function stripInvalidXml(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function xmlEscape(s: string): string {
  return stripInvalidXml(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** コードポイント境界で切り詰め（サロゲートペアを分断しない） */
function truncate(s: string, max: number): string {
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join("");
}

function eventUrl(ev: Event): string {
  return `${env.appBaseUrl}/events/${ev.id}`;
}

function imageUrl(ev: Event): string | null {
  return ev.imageUpdatedAt
    ? `${env.appBaseUrl}/api/events/${ev.id}/image?v=${ev.imageUpdatedAt}`
    : null;
}

const VENUE_LABEL: Record<string, string> = {
  offline: "オフライン",
  online: "オンライン",
  hybrid: "ハイブリッド",
};

/** 日時レンジの人間可読表記（フィード本文用・JST） */
function whenText(ev: Event): string {
  if (ev.scheduling) return "開催日時：調整中";
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);
  return `${fmt(ev.startsAt)} 〜 ${fmt(ev.endsAt)}`;
}

function summaryText(ev: Event): string {
  const parts = [whenText(ev), VENUE_LABEL[ev.venueType] ?? ev.venueType];
  const desc = truncate((ev.description || "").replace(/\s+/g, " ").trim(), 200);
  if (desc) parts.push(desc);
  return parts.join(" ／ ");
}

/** クエリからイベントを取得（フィード共通） */
async function fetchEvents(c: Context<AppEnv>): Promise<Event[]> {
  const q = c.req.query("q")?.trim() || undefined;
  const communityId = c.req.query("communityId") || undefined;
  const vt = c.req.query("venueType");
  const venueType =
    vt === "offline" || vt === "online" || vt === "hybrid" ? vt : undefined;
  const type = c.req.query("type") ?? "upcoming";
  const sortParam = c.req.query("sort");
  const limit = Math.min(
    MAX_ITEMS,
    Math.max(1, Number(c.req.query("limit")) || 20),
  );
  const now = Date.now();

  if (type === "scheduling") {
    // 日程調整中は専用リスト（開催日未定）
    return eventsRepo.listSchedulingPublished(limit, 0);
  }
  const from = c.req.query("from") ? Number(c.req.query("from")) : undefined;
  const to = c.req.query("to") ? Number(c.req.query("to")) : undefined;
  // type=past は終了済み（to=now, recent順）、それ以外は開催予定（from=now, soon順）
  const past = type === "past";
  return eventsRepo.searchPublished({
    q,
    communityId,
    venueType,
    // 日程調整中（開催日未定）はここには出さない（type=scheduling 専用）
    excludeScheduling: true,
    from: from ?? (past ? undefined : now),
    to: to ?? (past ? now : undefined),
    sort:
      sortParam === "recent" || sortParam === "new" || sortParam === "soon"
        ? sortParam
        : past
          ? "recent"
          : "soon",
    limit,
    offset: 0,
  });
}

/** そのままの取得URL（付与フィルタ込み・feed内のself用） */
function selfUrl(c: Context, ext: string): string {
  const u = new URL(c.req.url);
  return `${env.appBaseUrl}/feed/events.${ext}${u.search}`;
}

const CACHE = "public, max-age=300";

/** RSS 2.0 */
export async function feedRss(c: Context<AppEnv>) {
  const events = await fetchEvents(c);
  const items = events
    .map(
      (ev) => `    <item>
      <title>${xmlEscape(ev.title)}</title>
      <link>${xmlEscape(eventUrl(ev))}</link>
      <guid isPermaLink="false">${xmlEscape(ev.id)}</guid>
      <pubDate>${new Date(ev.createdAt).toUTCString()}</pubDate>
      <description>${xmlEscape(summaryText(ev))}</description>${
        imageUrl(ev)
          ? `\n      <enclosure url="${xmlEscape(imageUrl(ev)!)}" type="image/webp" />`
          : ""
      }
    </item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>events lab のイベント</title>
    <link>${xmlEscape(env.appBaseUrl)}/events</link>
    <description>events lab の公開イベント</description>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${xmlEscape(selfUrl(c, "rss"))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
  return c.body(xml, 200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": CACHE,
  });
}

/** JSON Feed 1.1（エージェント向け・機械可読の _event 拡張つき） */
export async function feedJson(c: Context<AppEnv>) {
  const events = await fetchEvents(c);
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: "events lab のイベント",
    home_page_url: `${env.appBaseUrl}/events`,
    feed_url: selfUrl(c, "json"),
    items: events.map((ev) => ({
      id: ev.id,
      url: eventUrl(ev),
      title: ev.title,
      content_text: summaryText(ev),
      date_published: new Date(ev.createdAt).toISOString(),
      ...(imageUrl(ev) ? { image: imageUrl(ev)! } : {}),
      _event: {
        startsAt: ev.scheduling ? null : new Date(ev.startsAt).toISOString(),
        endsAt: ev.scheduling ? null : new Date(ev.endsAt).toISOString(),
        scheduling: ev.scheduling,
        venueType: ev.venueType,
        communityId: ev.communityId,
        participantCount: ev.participantCount,
        slug: ev.slug,
      },
    })),
  };
  return c.body(JSON.stringify(feed), 200, {
    "Content-Type": "application/feed+json; charset=utf-8",
    "Cache-Control": CACHE,
  });
}

/** RFC5545 の 75 オクテット行折り返し（継続行は先頭に空白1個） */
function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const chBytes = enc.encode(ch).length;
    // 継続行は先頭空白1オクテットぶん詰めて 74 を上限にする
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + chBytes > limit) {
      out.push(cur);
      cur = ch;
      curBytes = chBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

/** iCalendar（.ics）。日程調整中（開催日未定）は VEVENT を出さない */
export async function feedIcs(c: Context<AppEnv>) {
  const events = await fetchEvents(c);
  const dt = (ms: number) =>
    new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) =>
    s
      // 制御文字を除去（CR/LFは改行エスケープに、TABは残す）
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n");
  let host = "events.kojira.io";
  try {
    host = new URL(env.appBaseUrl).hostname;
  } catch {
    // appBaseUrl が不正でも既定ホストで継続
  }
  const vevents = events
    .filter((ev) => !ev.scheduling)
    .map((ev) =>
      [
        "BEGIN:VEVENT",
        `UID:${ev.id}@${host}`,
        `DTSTAMP:${dt(ev.createdAt)}`,
        `DTSTART:${dt(ev.startsAt)}`,
        `DTEND:${dt(ev.endsAt)}`,
        `SUMMARY:${esc(ev.title)}`,
        `DESCRIPTION:${esc(summaryText(ev))}`,
        `URL:${eventUrl(ev)}`,
        "END:VEVENT",
      ]
        .map(foldIcsLine)
        .join("\r\n"),
    )
    .join("\r\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//events lab//JP",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:events lab のイベント",
    vevents,
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
  return c.body(ics, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": CACHE,
  });
}
