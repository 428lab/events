import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/worker.js";
import { bindEnv, type Env } from "../src/runtime.js";
import { eventsRepo } from "../src/db/repositories/events.js";
import { canViewEvent, requireEventAccess } from "../src/auth/eventAccess.js";
import { usersRepo } from "../src/db/repositories/users.js";

const BASE = "https://example.com";
const DAY = 86_400_000;
let eventId: string;
let owner: { id: string; cookie: string };
let outsider: { id: string; cookie: string };

async function makeUser() {
  const id = crypto.randomUUID();
  const session = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, `test:${id}`, `user-${id}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(session, id, Date.now() + DAY).run();
  return { id, cookie: `eventer_session=${session}` };
}

async function request(path = "", cookie?: string, method = "GET", body?: unknown) {
  return SELF.fetch(`${BASE}/api/events/${eventId}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  bindEnv(env as unknown as Env);
  owner = await makeUser();
  outsider = await makeUser();
  const res = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "private-access-fixture", venueType: "online", startsAt: Date.now() + DAY, endsAt: Date.now() + 2 * DAY }),
  });
  expect(res.status).toBe(201);
  const { event } = await res.json() as { event: { id: string; visibility: string; accessRevision: number } };
  expect(event.visibility).toBe("public");
  expect(event.accessRevision).toBe(0);
  eventId = event.id;
  // Local D1 fixture only: the unfinished feature's mutation entrance stays closed.
  await env.DB.prepare("UPDATE event SET visibility = 'private', status = 'published' WHERE id = ?").bind(eventId).run();
});

async function grant(status: string, expiresAt: number | null = Date.now() + DAY) {
  await env.DB.prepare(`INSERT INTO event_access_invite
    (id, event_id, user_id, invited_by, status, source, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'invite', ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, expires_at = excluded.expires_at`)
    .bind(crypto.randomUUID(), eventId, outsider.id, owner.id, status, Date.now(), expiresAt).run();
}

async function member(role = "participant", status = "confirmed") {
  await env.DB.prepare(`INSERT INTO event_member (id, event_id, user_id, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET role = excluded.role, status = excluded.status`)
    .bind(crypto.randomUUID(), eventId, outsider.id, role, status, Date.now()).run();
}

async function hidden(res: Response) {
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("vary")).toContain("Cookie");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}

const eventRoutes = [...new Map(app.routes
  .filter((r) => r.path.startsWith("/api/events/:id") && r.method !== "ALL")
  .map((r) => [`${r.method} ${r.path}`, r])).values()];

describe("eventAccess: the actual router's private boundary", () => {
  it("has one visibility gate before each event handler, including direct detail", () => {
    expect(eventRoutes.length).toBeGreaterThan(150);
    for (const route of eventRoutes) {
      const path = route.path.replace(/:id(?=\/|$)/g, eventId).replace(/:[^/]+/g, crypto.randomUUID());
      const match = (app as any).router.match(route.method, path)[0];
      const handlers = match.map((entry: any) => entry[0][0]);
      expect(handlers.filter((h: unknown) => h === requireEventAccess).length, `${route.method} ${route.path}`).toBe(1);
      expect(handlers.indexOf(requireEventAccess)).toBeLessThan(handlers.indexOf(route.handler));
    }
  });

  it("denies every registered child verb before role, payload, feature and media processing", async () => {
    for (const route of eventRoutes) {
      const path = route.path.replace(/:id(?=\/|$)/g, eventId).replace(/:[^/]+/g, crypto.randomUUID());
      const res = await SELF.fetch(`${BASE}${path}`, { method: route.method, headers: { cookie: outsider.cookie } });
      expect(res.status, `${route.method} ${route.path}`).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });

  it("does not disclose metadata through HEAD, Range, ETag, missing routes or oversized bodies", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}/image`, {
        method, headers: { Range: "bytes=0-0", "If-None-Match": "*" },
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("etag")).toBeNull();
      expect(res.headers.get("content-range")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    await hidden(await request("/not-a-route"));
    const oversized = await SELF.fetch(`${BASE}/api/events/${eventId}/image`, {
      method: "PUT", headers: { "content-length": String(9 * 1024 * 1024) }, body: new Uint8Array(9 * 1024 * 1024),
    });
    await hidden(oversized);
  });

  it.each(["pending", "declined", "revoked", "expired"])("%s is not private access, even with a member row", async (status) => {
    await grant(status === "expired" ? "pending" : status, status === "expired" ? Date.now() - 1 : Date.now() + DAY);
    await member();
    await hidden(await request("", outsider.cookie));
  });

  it("an accepted grant fixture allows viewing without treating it as membership", async () => {
    await grant("accepted", null);
    const res = await request("", outsider.cookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("access_operation_token");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_member WHERE event_id = ? AND user_id = ?").bind(eventId, outsider.id).first<{ n: number }>();
    expect(count?.n).toBe(0);
    const photos = await request("/photos", outsider.cookie);
    expect(photos.status).toBe(403);
    expect((await request("/staff-chat", outsider.cookie)).status).toBe(403);
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?").bind(Date.now(), outsider.id).run();
    await hidden(await request("", outsider.cookie));
  });

  it.each(["draft", "archived"])("%s needs membership in addition to accepted access", async (status) => {
    await grant("accepted", null);
    await env.DB.prepare("UPDATE event SET status = ? WHERE id = ?").bind(status, eventId).run();
    await hidden(await request("", outsider.cookie));
    await member();
    expect((await request("", outsider.cookie)).status).toBe(200);
    await member("participant", "canceled");
    await hidden(await request("", outsider.cookie));
    expect((await request("", owner.cookie)).status).toBe(200);
  });

  it("active staff can manage, canceled staff and the creator column alone cannot", async () => {
    await member("staff");
    expect((await request("", outsider.cookie)).status).toBe(200);
    await member("staff", "canceled");
    await hidden(await request("", outsider.cookie));
    await env.DB.prepare("DELETE FROM event_member WHERE event_id = ? AND user_id = ?").bind(eventId, owner.id).run();
    await hidden(await request("", owner.cookie));
  });

  it.each(["public", "unlisted"])("published %s remains anonymously viewable but join still requires login", async (visibility) => {
    await env.DB.prepare("UPDATE event SET visibility = ? WHERE id = ?").bind(visibility, eventId).run();
    expect((await request()).status).toBe(200);
    expect((await request("/join", undefined, "POST", {})).status).toBe(401);
  });

  it("SQL authorization uses the current row, not stale Event/User values", async () => {
    await grant("accepted", null);
    const event = (await eventsRepo.findById(eventId))!;
    const user = (await usersRepo.findById(outsider.id))!;
    expect(await canViewEvent(event, user)).toBe(true);
    await grant("revoked", null);
    expect(await canViewEvent(event, user)).toBe(false);
  });

  it("nonpublic creation, copying and visibility updates remain explicitly closed", async () => {
    for (const visibility of ["unlisted", "private"]) {
      const res = await SELF.fetch(`${BASE}/api/events`, {
        method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "not-created", venueType: "online", visibility }),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "private_events_unavailable" });
    }
    expect((await request("", owner.cookie, "PATCH", { visibility: "public" })).status).toBe(409);
    expect((await request("/duplicate", owner.cookie, "POST")).status).toBe(409);
    for (const visibility of [null, "secret"]) {
      expect((await request("", owner.cookie, "PATCH", { visibility })).status).toBe(400);
    }
  });
});
