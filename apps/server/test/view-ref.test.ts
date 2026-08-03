import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

describe("流入元 ref パラメータの計測 (#118)", () => {
  it("?ref=notification/feed は source として記録され、不正値は referrer にフォールバック", async () => {
    const cookie = await loginDev();
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "ref計測E2E",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "published" }),
    });

    // 匿名ビュー: 通知経由・フィード経由・不正 ref（外部 referrer 扱い）
    const view = (body: Record<string, unknown>) =>
      SELF.fetch(`${BASE}/api/events/${event.id}/view`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await view({ refParam: "notification" })).status).toBe(204);
    expect((await view({ refParam: "feed" })).status).toBe(204);
    // ライセンスカードのQRコード経由 (#178)
    expect((await view({ refParam: "card" })).status).toBe(204);
    expect(
      (await view({ refParam: "evil", ref: "https://example.org/page" })).status,
    ).toBe(204);

    const stats = await SELF.fetch(`${BASE}/api/events/${event.id}/stats`, {
      headers: { cookie },
    });
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as {
      sources: { source: string; views: number }[];
    };
    const bySource = Object.fromEntries(
      body.sources.map((s) => [s.source, s.views]),
    );
    expect(bySource["notification"]).toBe(1);
    expect(bySource["feed"]).toBe(1);
    expect(bySource["card"]).toBe(1);
    // 許可リスト外の refParam は無視され referrer ホストで記録
    expect(bySource["example.org"]).toBe(1);
    expect(bySource["evil"]).toBeUndefined();
  });

  it("RSSフィードのイベントURLに ?ref=feed が付く", async () => {
    // 分離ストレージでテスト間のDBは巻き戻るため、このテスト内で公開イベントを作る
    const cookie = await loginDev();
    const create = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "フィードref付与E2E",
        venueType: "online",
        startsAt: Date.now() + 3600_000,
        endsAt: Date.now() + 7200_000,
      }),
    });
    const { event } = (await create.json()) as { event: { id: string } };
    await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "published" }),
    });

    const res = await SELF.fetch(`${BASE}/feed/events.rss`);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<item>");
    expect(xml).toContain(`/events/${event.id}?ref=feed`);
  });
});
