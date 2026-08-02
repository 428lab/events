import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** dev-login してセッションcookieを返す */
async function login(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie!.split(";")[0];
}

describe("smoke", () => {
  it("GET /api/health returns ok", async () => {
    const res = await SELF.fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("未認証の /api/auth/me は 401", async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  it("dev-login → イベント作成 → 取得", async () => {
    const cookie = await login();
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "E2Eテストイベント",
        venueType: "offline",
        startsAt: 1,
        endsAt: 99999999999999,
      }),
    });
    expect(create.status).toBe(201);
    const { event } = (await create.json()) as { event: { id: string; title: string } };
    expect(event.title).toBe("E2Eテストイベント");

    const got = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      headers: { cookie },
    });
    expect(got.status).toBe(200);
  });

  it("公開イベント検索: communityId 絞り込みと limit ページングが効く (#98)", async () => {
    const cookie = await login();
    const suffix = crypto.randomUUID().slice(0, 8);

    // コミュニティ作成
    const comRes = await SELF.fetch(`${BASE}/api/communities`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slug: `search-${suffix}`, name: `検索用_${suffix}` }),
    });
    expect(comRes.status).toBe(201);
    const community = (await comRes.json()) as { id: string };

    // コミュニティ所属の公開イベント3件＋無所属1件
    const now = Date.now();
    const createPublished = async (title: string, communityId?: string) => {
      const res = await SELF.fetch(`${BASE}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          title,
          venueType: "online",
          startsAt: now + 3600_000,
          endsAt: now + 7200_000,
          ...(communityId ? { communityId } : {}),
        }),
      });
      expect(res.status).toBe(201);
      const { event } = (await res.json()) as { event: { id: string } };
      const pub = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ status: "published" }),
      });
      expect(pub.status).toBe(200);
    };
    for (let i = 1; i <= 3; i++) {
      await createPublished(`検索対象_${suffix}_${i}`, community.id);
    }
    await createPublished(`検索対象外_${suffix}`);

    // communityId 絞り込み＋limit=2 → 総数3・1ページ目2件・hasMore
    const page1 = await SELF.fetch(
      `${BASE}/api/public/events/search?communityId=${community.id}&limit=2&page=1`,
    );
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as {
      events: { title: string; communityId: string | null }[];
      total: number;
      limit: number;
      hasMore: boolean;
    };
    expect(body1.total).toBe(3);
    expect(body1.limit).toBe(2);
    expect(body1.events).toHaveLength(2);
    expect(body1.hasMore).toBe(true);
    for (const e of body1.events) expect(e.communityId).toBe(community.id);

    // 2ページ目は残り1件で打ち止め
    const page2 = await SELF.fetch(
      `${BASE}/api/public/events/search?communityId=${community.id}&limit=2&page=2`,
    );
    const body2 = (await page2.json()) as {
      events: { communityId: string | null }[];
      hasMore: boolean;
    };
    expect(body2.events).toHaveLength(1);
    expect(body2.hasMore).toBe(false);
  });
});
