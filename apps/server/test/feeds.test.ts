import { SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

const BASE = "https://example.com";

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function createPublished(
  cookie: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const now = Date.now();
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title,
      venueType: "online",
      startsAt: now + 3600_000,
      endsAt: now + 7200_000,
      ...extra,
    }),
  });
  const { event } = (await create.json()) as { event: { id: string } };
  await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  return event.id;
}

describe("イベントフィード (#19)", () => {
  let unique: string;
  beforeAll(async () => {
    const cookie = await loginDev();
    unique = `フィード検証_${crypto.randomUUID().slice(0, 8)}`;
    await createPublished(cookie, unique);
  });

  it("JSON Feed: 未ログインで取得でき、公開イベントと機械可読 _event を含む", async () => {
    const res = await SELF.fetch(`${BASE}/feed/events.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/feed+json");
    const feed = (await res.json()) as {
      version: string;
      items: { title: string; url: string; _event: { venueType: string } }[];
    };
    expect(feed.version).toContain("jsonfeed.org");
    const item = feed.items.find((i) => i.title === unique);
    expect(item).toBeTruthy();
    expect(item!.url).toContain("/events/");
    expect(item!._event.venueType).toBe("online");
  });

  it("RSS: 未ログインで取得でき、rss+xml で item を含む", async () => {
    const res = await SELF.fetch(`${BASE}/feed/events.rss`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain("<rss");
    expect(xml).toContain(unique);
  });

  it("iCal: text/calendar で VEVENT を含む", async () => {
    const res = await SELF.fetch(`${BASE}/feed/events.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
  });

  it("venueType フィルタ: offline 指定では online イベントが出ない", async () => {
    const res = await SELF.fetch(`${BASE}/feed/events.json?venueType=offline`);
    const feed = (await res.json()) as { items: { title: string }[] };
    expect(feed.items.some((i) => i.title === unique)).toBe(false);
  });

  it("type=past: 日程調整中（開催日未定）イベントは過去フィードに出さない", async () => {
    const cookie = await loginDev();
    const schedTitle = `調整中_${crypto.randomUUID().slice(0, 8)}`;
    // 開催日未定（scheduling=true）の公開イベント。starts_at=0 なので to=now 条件に引っかかりうる
    await createPublished(cookie, schedTitle, {
      scheduling: true,
      startsAt: 0,
      endsAt: 0,
    });
    const res = await SELF.fetch(`${BASE}/feed/events.json?type=past`);
    const feed = (await res.json()) as { items: { title: string }[] };
    expect(feed.items.some((i) => i.title === schedTitle)).toBe(false);
  });

  it("RSS: タイトルの XML 非許容制御文字は除去され、整形式を保つ", async () => {
    const cookie = await loginDev();
    const label = crypto.randomUUID().slice(0, 8);
    // U+0000 と U+0001 は XML1.0 で実体参照でも表現不可。混入しても feed 全体が壊れないこと
    await createPublished(cookie, `制御\u0000\u0001文字${label}`);
    const res = await SELF.fetch(`${BASE}/feed/events.rss`);
    const xml = await res.text();
    expect(res.status).toBe(200);
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(xml).not.toContain("&#0;");
    expect(xml).toContain(`制御文字${label}`);
  });
});
