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
});
