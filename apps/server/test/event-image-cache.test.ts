import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/**
 * イベント画像（表紙）の Cache-Control (#496)。固定したい契約:
 *
 * 版付き URL（?v=<imageUpdatedAt>）の公開イベントでも `private, no-store` + `Vary: Cookie`。
 * イベント配下の応答はすべて閲覧の門（requireEventAccess, #526）が最後にこの値で上書きする。
 * 公開→非公開の切り替えをすぐ効かせるため（docs/private-events.md の cache 方針）で、
 * 共有キャッシュや長期キャッシュに載せない。画像ハンドラ側で別の値を付けても効かない。
 */

async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"),
  (c) => c.charCodeAt(0),
);

async function publicEventWithImage(): Promise<{ eventId: string; version: number }> {
  const cookie = await loginDev();
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "画像キャッシュ", venueType: "offline", startsAt: 1, endsAt: 99999999999999 }),
  });
  expect(create.status).toBe(201);
  const eventId = ((await create.json()) as { event: { id: string } }).event.id;
  await env.DB.prepare("UPDATE event SET visibility = 'public', status = 'published' WHERE id = ?")
    .bind(eventId)
    .run();
  const put = await SELF.fetch(`${BASE}/api/events/${eventId}/image`, {
    method: "PUT",
    headers: { cookie, "content-type": "image/png" },
    body: PNG,
  });
  expect(put.status).toBe(200);
  const row = await env.DB.prepare("SELECT image_updated_at AS v FROM event WHERE id = ?")
    .bind(eventId)
    .first<{ v: number }>();
  return { eventId, version: row!.v };
}

describe("イベント画像の Cache-Control (#496)", () => {
  it("公開イベントの版付き URL でも private, no-store + Vary: Cookie（未ログインで取れる）", async () => {
    const { eventId, version } = await publicEventWithImage();
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/image?v=${version}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toContain("Cookie");
    expect(res.headers.get("etag")).toBe(`"${version}"`);
    await res.arrayBuffer();
  });

  it("版なし URL と 304 も同じ値", async () => {
    const { eventId, version } = await publicEventWithImage();
    const plain = await SELF.fetch(`${BASE}/api/events/${eventId}/image`);
    expect(plain.status).toBe(200);
    expect(plain.headers.get("cache-control")).toBe("private, no-store");
    await plain.arrayBuffer();
    const notModified = await SELF.fetch(`${BASE}/api/events/${eventId}/image?v=${version}`, {
      headers: { "If-None-Match": `"${version}"` },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("cache-control")).toBe("private, no-store");
  });
});
