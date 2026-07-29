import { SELF, env } from "cloudflare:test";
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

  it("たまごフィード: JSON/RSS が取得でき、メンバー限定は出ない (#51)", async () => {
    const cookie = await loginDev();
    const tag = crypto.randomUUID().slice(0, 8);
    // 公開たまご
    const open = await SELF.fetch(`${BASE}/api/event-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: `フィードたまご_${tag}` }),
    });
    expect(open.status).toBe(201);

    const res = await SELF.fetch(`${BASE}/feed/requests.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/feed+json");
    const feed = (await res.json()) as {
      items: {
        title: string;
        _request: { attendCount: number; hostCount: number; slug: string };
      }[];
    };
    const item = feed.items.find((i) => i.title === `フィードたまご_${tag}`);
    expect(item).toBeTruthy();
    expect(item!._request.attendCount).toBe(0);
    expect(item!._request.slug).toMatch(/^[0-9a-f]{8}$/);

    const rss = await SELF.fetch(`${BASE}/feed/requests.rss`);
    expect(rss.status).toBe(200);
    expect(await rss.text()).toContain(`フィードたまご_${tag}`);

    // メンバー限定たまごはフィードに出ない
    const uid = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO community (id, slug, name, owner_id, created_at) SELECT ?, ?, 'フィード限定検証', id, ? FROM user LIMIT 1",
    )
      .bind(uid, `c${uid.slice(0, 8)}`, Date.now())
      .run();
    const owner = await env.DB.prepare(
      "SELECT owner_id AS id FROM community WHERE id = ?",
    )
      .bind(uid)
      .first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
      .bind(crypto.randomUUID(), uid, owner!.id, Date.now())
      .run();
    await env.DB.prepare(
      `INSERT INTO event_request (id, title, description, community_id, members_only, status, created_by, created_at, slug)
       VALUES (?, ?, '', ?, 1, 'open', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        `限定フィードたまご_${tag}`,
        uid,
        owner!.id,
        Date.now(),
        crypto.randomUUID().replace(/-/g, "").slice(0, 8),
      )
      .run();
    const withSecret = await SELF.fetch(`${BASE}/feed/requests.json`);
    const secretFeed = (await withSecret.json()) as {
      items: { title: string }[];
    };
    expect(
      secretFeed.items.some((i) => i.title === `限定フィードたまご_${tag}`),
    ).toBe(false);

    // 検索フィルタ
    const filtered = await SELF.fetch(
      `${BASE}/feed/requests.json?q=${encodeURIComponent(`存在しない_${tag}`)}`,
    );
    const fBody = (await filtered.json()) as { items: unknown[] };
    expect(fBody.items.length).toBe(0);
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
