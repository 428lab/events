import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { EventPhotosPage } from "@eventer/shared";

const BASE = "https://example.com";

async function setup(count: number) {
  const login = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const me = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const { user } = await me.json() as { user: { id: string } };
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "Gallery pagination", venueType: "offline", startsAt: 1, endsAt: 99999999999999 }),
  });
  expect(res.status).toBe(201);
  const { event } = await res.json() as { event: { id: string } };
  await env.DB.prepare("UPDATE event SET status = 'published', photos_public = 1 WHERE id = ?")
    .bind(event.id).run();
  const ids = Array.from({ length: count }, (_, i) => `${event.id}-${String(i).padStart(3, "0")}`);
  // Many equal timestamps across page boundaries; mix photos/videos in one order.
  if (count) await env.DB.batch(ids.map((id, i) => env.DB.prepare(
    "INSERT INTO event_photo (id, event_id, user_id, created_at, kind, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, event.id, user.id, Math.floor(i / 30), i % 2 ? "video" : "photo", i % 2 ? 42000 : null)));
  const url = `${BASE}/api/events/${event.id}/photos`;
  const page = async (n: number) => {
    const response = await SELF.fetch(`${url}?page=${n}`);
    expect(response.status).toBe(200);
    return await response.json() as EventPhotosPage;
  };
  return { eventId: event.id, userId: user.id, cookie, ids, url, page };
}

describe("event gallery bounded pagination", () => {
  it.each([0, 24, 25, 200])("%i visible mixed media: exact boundaries, newest/tied order, legacy compatibility", async (count) => {
    const fx = await setup(count);
    const collected: string[] = [];
    for (let n = 1; n <= Math.max(1, Math.ceil(count / 24)); n++) {
      const result = await fx.page(n);
      expect(result).toMatchObject({ total: count, page: n, limit: 24 });
      expect(result.photos).toHaveLength(Math.min(24, count - (n - 1) * 24));
      collected.push(...result.photos.map((p) => p.id));
      for (const p of result.photos) {
        const i = fx.ids.indexOf(p.id);
        expect(p.kind).toBe(i % 2 ? "video" : "photo");
        expect(p.durationMs).toBe(i % 2 ? 42000 : null);
      }
    }
    expect(collected).toEqual([...fx.ids].reverse());
    expect(new Set(collected).size).toBe(count);
    const beyond = await fx.page(Math.max(1, Math.ceil(count / 24)) + 1);
    expect(beyond.photos).toEqual([]);
    expect(beyond.total).toBe(count);
    const legacy = await (await SELF.fetch(fx.url)).json() as { photos: { id: string }[] };
    expect(Object.keys(legacy)).toEqual(["photos"]);
    expect(legacy.photos.map((p) => p.id)).toEqual(collected);
  });

  it("total excludes hidden media/deleted authors, but upload slots still include them; comments retain visibility rules", async () => {
    const fx = await setup(25);
    const deletedUser = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at, deleted_at) VALUES (?, ?, 'Deleted', 1, 2)")
      .bind(deletedUser, deletedUser).run();
    await env.DB.prepare("UPDATE event_photo SET admin_hidden_at = 2 WHERE id = ?")
      .bind(fx.ids[24]).run();
    await env.DB.prepare("UPDATE event_photo SET user_id = ? WHERE id = ?")
      .bind(deletedUser, fx.ids[23]).run();
    for (const [author, hidden] of [[fx.userId, null], [deletedUser, null], [fx.userId, 2]] as const) {
      await env.DB.prepare("INSERT INTO event_photo_comment (id, photo_id, user_id, body, created_at, admin_hidden_at) VALUES (?, ?, ?, 'comment', 1, ?)")
        .bind(crypto.randomUUID(), fx.ids[22], author, hidden).run();
    }
    const page = await fx.page(1);
    expect(page.total).toBe(23);
    expect(page.photos.map((p) => p.id)).toEqual(fx.ids.slice(0, 23).reverse());
    expect(page.photos[0].commentCount).toBe(1);
    expect((await fx.page(2)).photos).toEqual([]);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_photo WHERE event_id = ?")
      .bind(fx.eventId).first<{ n: number }>();
    expect(count?.n).toBe(25);
  });

  it("deleting the last page and uploading refresh the actual visible total", async () => {
    const fx = await setup(25);
    const last = (await fx.page(2)).photos[0];
    const del = await SELF.fetch(`${fx.url}/${last.id}`, { method: "DELETE", headers: { cookie: fx.cookie } });
    expect(del.status).toBe(200);
    expect(await fx.page(2)).toMatchObject({ photos: [], total: 24 });
    const up = await SELF.fetch(fx.url, {
      method: "POST", headers: { cookie: fx.cookie, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    });
    expect(up.status).toBe(201);
    const { photo } = await up.json() as { photo: { id: string } };
    const first = await fx.page(1);
    expect(first.total).toBe(25);
    expect(first.photos[0].id).toBe(photo.id);
    expect((await fx.page(2)).photos).toHaveLength(1);
  });

  it("validates page without bypassing private/draft visibility", async () => {
    const fx = await setup(1);
    for (const value of ["", "0", "-1", "1.5", "abc", "1e2", "9007199254740991"]) {
      expect((await SELF.fetch(`${fx.url}?page=${value}`)).status).toBe(400);
    }
    await env.DB.prepare("UPDATE event SET photos_public = 0 WHERE id = ?").bind(fx.eventId).run();
    expect((await SELF.fetch(`${fx.url}?page=1`)).status).toBe(403);
    expect((await SELF.fetch(`${fx.url}?page=invalid`)).status).toBe(403);
    expect((await SELF.fetch(`${fx.url}?page=1`, { headers: { cookie: fx.cookie } })).status).toBe(200);
    await env.DB.prepare("UPDATE event SET photos_public = 1, status = 'draft' WHERE id = ?").bind(fx.eventId).run();
    expect((await SELF.fetch(`${fx.url}?page=1`)).status).toBe(403);
  });
});
