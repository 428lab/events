import { SELF, env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { EVENT_THUMBNAIL_MAX_BYTES } from "@eventer/shared";
import type { EventPhoto, EventPhotosPage } from "@eventer/shared";
import fixtures from "./fixtures/gallery-thumbnails.json";
import { validThumbnailBytes } from "../src/lib/galleryThumbnail.js";

const BASE = "https://example.com";
// Drain streamed R2 responses before isolated-storage teardown, even for status assertions.
async function request(url: string, init?: RequestInit): Promise<Response> {
  const res = await SELF.fetch(url, init);
  return new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers });
}
const decode = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const jpeg = decode(fixtures.jpeg);
const webp = decode(fixtures.webp);
const video = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const login = await request(`${BASE}/api/auth/dev-login`, { method: "POST" });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const res = await request(`${BASE}/api/events`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "Thumbnails", venueType: "offline", startsAt: 1, endsAt: 99999999999999 }),
  });
  expect(res.status).toBe(201);
  const { event } = await res.json() as { event: { id: string } };
  return { cookie, eventId: event.id };
}
function form(kind: "photo" | "video", thumbnail: Blob | string | null = new Blob([webp], { type: "image/webp" })) {
  const fd = new FormData();
  fd.append(kind, new Blob([kind === "photo" ? jpeg : video], { type: kind === "photo" ? "image/jpeg" : "video/webm" }), kind);
  if (kind === "video") {
    fd.append("poster", new Blob([jpeg], { type: "image/jpeg" }), "poster");
    fd.append("durationMs", "1000");
  }
  if (thumbnail !== null) fd.append("thumbnail", thumbnail);
  return fd;
}
async function upload(eventId: string, cookie: string, kind: "photo" | "video", body = form(kind)) {
  return request(`${BASE}/api/events/${eventId}/${kind === "photo" ? "photos" : "videos"}`, {
    method: "POST", headers: { cookie }, body,
  });
}
async function count(eventId: string) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM event_photo WHERE event_id = ?").bind(eventId).first<{ n: number }>())!.n;
}

describe("gallery thumbnail byte validation", () => {
  it("accepts actual browser WebP/JPEG and rejects mismatched MIME, truncation and excessive bytes", () => {
    expect(validThumbnailBytes(webp, "image/webp")).toBe(true);
    expect(validThumbnailBytes(jpeg, "image/jpeg")).toBe(true);
    expect(validThumbnailBytes(jpeg, "image/webp")).toBe(false);
    expect(validThumbnailBytes(webp, "image/jpeg")).toBe(false);
    expect(validThumbnailBytes(webp.slice(0, -1), "image/webp")).toBe(false);
    expect(validThumbnailBytes(new Uint8Array(EVENT_THUMBNAIL_MAX_BYTES + 1), "image/jpeg")).toBe(false);
  });
  it("accepts new 320px and legacy 480px dimensions, but rejects zero and 481px", () => {
    for (const width of [0, 320, 480, 481]) {
      const bytes = jpeg.slice();
      const sof = bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0xc0);
      expect(sof).toBeGreaterThan(0);
      bytes[sof + 7] = width >> 8; bytes[sof + 8] = width & 255;
      expect(validThumbnailBytes(bytes, "image/jpeg")).toBe(width === 320 || width === 480);
      const wp = webp.slice();
      const chunk = wp.findIndex((b, i) => b === 0x56 && wp[i + 1] === 0x50 && wp[i + 2] === 0x38 && wp[i + 3] === 0x20);
      expect(chunk).toBeGreaterThan(0);
      wp[chunk + 14] = width & 255; wp[chunk + 15] = width >> 8;
      expect(validThumbnailBytes(wp, "image/webp")).toBe(width === 320 || width === 480);
    }
  });
});

describe("gallery thumbnail upload, serving and lifecycle", () => {
  it.each(["photo", "video"] as const)("stores %s variants and serves small versus main bytes; paged + legacy metadata and delete", async (kind) => {
    const { eventId, cookie } = await setup();
    const res = await upload(eventId, cookie, kind);
    expect(res.status).toBe(201);
    const { photo } = await res.json() as { photo: EventPhoto };
    expect(photo.hasThumbnail).toBe(true);
    const path = `${BASE}/api/events/${eventId}/photos/${photo.id}`;
    const small = await request(`${path}/thumbnail`, { headers: { cookie } });
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/webp");
    expect(small.headers.get("x-content-type-options")).toBe("nosniff");
    expect(small.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await small.arrayBuffer())).toEqual(webp);
    const main = await request(`${path}/${kind === "photo" ? "image" : "poster"}`, { headers: { cookie } });
    expect(main.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await main.arrayBuffer())).toEqual(jpeg);
    for (const query of ["", "?page=1"]) {
      const list = await request(`${BASE}/api/events/${eventId}/photos${query}`, { headers: { cookie } });
      const data = await list.json() as EventPhotosPage;
      expect(data.photos[0]!.hasThumbnail).toBe(true);
      if (query) expect(data.limit).toBe(24);
    }
    expect((await request(path, { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect((await env.BUCKET.list({ prefix: `event-${kind === "photo" ? "photos" : "videos"}/${eventId}/` })).objects).toHaveLength(0);
  });

  it("accepts JPEG fallback and multipart omission, and refuses a video variant without a poster", async () => {
    const { eventId, cookie } = await setup();
    const res = await upload(eventId, cookie, "photo", form("photo", new Blob([jpeg], { type: "image/jpeg" })));
    expect(res.status).toBe(201);
    const { photo } = await res.json() as { photo: EventPhoto };
    const image = await request(`${BASE}/api/events/${eventId}/photos/${photo.id}/thumbnail`, { headers: { cookie } });
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);
    const legacy = await upload(eventId, cookie, "photo", form("photo", null));
    expect(legacy.status).toBe(201);
    expect((await legacy.json() as { photo: EventPhoto }).photo.hasThumbnail).toBe(false);
    const noPoster = form("video"); noPoster.delete("poster");
    expect((await upload(eventId, cookie, "video", noPoster)).status).toBe(400);
  });

  it("preserves old raw photo and old video uploads without a variant", async () => {
    const { eventId, cookie } = await setup();
    const raw = await request(`${BASE}/api/events/${eventId}/photos`, {
      method: "POST", headers: { cookie, "content-type": "image/jpeg" }, body: jpeg,
    });
    expect(raw.status).toBe(201);
    for (const res of [raw, await upload(eventId, cookie, "video", form("video", null))]) {
      expect(res.status).toBe(201);
      const { photo } = await res.json() as { photo: EventPhoto };
      expect(photo.hasThumbnail).toBe(false);
      expect((await request(`${BASE}/api/events/${eventId}/photos/${photo.id}/thumbnail`, { headers: { cookie } })).status).toBe(404);
    }
  });

  it("keeps private, hidden, deleted-author and wrong-event thumbnails inaccessible", async () => {
    const { eventId, cookie } = await setup();
    const { photo } = await (await upload(eventId, cookie, "photo")).json() as { photo: EventPhoto };
    const url = `${BASE}/api/events/${eventId}/photos/${photo.id}/thumbnail`;
    expect((await request(url)).status).toBe(403);
    await env.DB.prepare("UPDATE event SET photos_public = 1, status = 'published' WHERE id = ?").bind(eventId).run();
    expect((await request(url)).status).toBe(200);
    const other = await setup();
    expect((await request(url.replace(eventId, other.eventId), { headers: { cookie } })).status).toBe(404);
    await env.DB.prepare("UPDATE event_photo SET admin_hidden_at = 1 WHERE id = ?").bind(photo.id).run();
    expect((await request(url, { headers: { cookie } })).status).toBe(404);
    await env.DB.prepare("UPDATE event_photo SET admin_hidden_at = NULL WHERE id = ?").bind(photo.id).run();
    await env.DB.prepare("UPDATE user SET deleted_at = 1 WHERE id = ?").bind(photo.userId).run();
    expect((await request(url)).status).toBe(404);
  });

  it.each(["photo", "video"] as const)("rejects invalid %s thumbnail before any writes", async (kind) => {
    const { eventId, cookie } = await setup();
    const put = vi.spyOn(env.BUCKET, "put");
    for (const thumb of ["not-a-file", new Blob([jpeg], { type: "image/png" }), new Blob([new Uint8Array(EVENT_THUMBNAIL_MAX_BYTES + 1)], { type: "image/jpeg" }), new Blob([], { type: "image/jpeg" })]) {
      const res = await upload(eventId, cookie, kind, form(kind, thumb));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_thumbnail" });
    }
    expect(put).not.toHaveBeenCalled();
    expect(await count(eventId)).toBe(0);
  });

  it.each([["photo", "main"], ["photo", "thumbnail"], ["video", "main"], ["video", "poster"], ["video", "thumbnail"]] as const)("cleans all %s keys when %s put fails after writing", async (kind, stage) => {
    const { eventId, cookie } = await setup();
    const original = env.BUCKET.put.bind(env.BUCKET);
    vi.spyOn(env.BUCKET, "put").mockImplementation(async (key, value, options) => {
      const result = await original(key, value, options);
      if (stage === "main" ? !key.endsWith("-poster") && !key.endsWith("-thumbnail") : key.endsWith(`-${stage}`)) throw new Error("injected object failure");
      return result;
    });
    expect((await upload(eventId, cookie, kind)).status).toBe(500);
    expect(await count(eventId)).toBe(0);
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
  });

  it.each(["photo", "video"] as const)("cleans all %s keys if D1 insert fails", async (kind) => {
    const { eventId, cookie } = await setup();
    await env.DB.exec("CREATE TRIGGER reject_media BEFORE INSERT ON event_photo BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;");
    expect((await upload(eventId, cookie, kind)).status).toBe(500);
    expect(await count(eventId)).toBe(0);
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
  });
});
