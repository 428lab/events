import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { bindEnv, type Env } from "../src/runtime.js";
import { eventLiveCutinRepo } from "../src/db/repositories/eventLiveCutin.js";

beforeAll(() => bindEnv(env as unknown as Env));
async function fixture() {
  const eventId = crypto.randomUUID(), otherEventId = crypto.randomUUID(), users = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const id of users) await env.DB.prepare("INSERT INTO user(id, discord_id, username, global_name, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, `nostr:${id}`, id, id, Date.now()).run();
  const cookies: string[] = [];
  for (const id of users) {
    const session = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO session(id, user_id, expires_at) VALUES (?, ?, ?)").bind(session, id, Date.now() + 86400000).run();
    cookies.push(`eventer_session=${session}`);
  }
  for (const id of [eventId, otherEventId]) {
    await env.DB.prepare("INSERT INTO event(id, title, description, starts_at, ends_at, venue_type, participation_type, status, created_by, created_at) VALUES (?, 'live', '', ?, ?, 'online', 'individual', 'published', ?, ?)").bind(id, Date.now() - 1000, Date.now() + 900000, users[0], Date.now()).run();
    await env.DB.prepare("INSERT INTO event_member(id, event_id, user_id, role, status, attended, created_at) VALUES (?, ?, ?, 'staff', 'confirmed', 0, ?)").bind(crypto.randomUUID(), id, users[0], Date.now()).run();
  }
  await env.DB.prepare("INSERT INTO event_member(id, event_id, user_id, role, status, attended, created_at) VALUES (?, ?, ?, 'staff', 'confirmed', 0, ?)").bind(crypto.randomUUID(), eventId, users[1], Date.now()).run();
  await env.DB.prepare("INSERT INTO event_member(id, event_id, user_id, role, status, attended, created_at) VALUES (?, ?, ?, 'staff', 'pending', 0, ?)").bind(crypto.randomUUID(), eventId, users[2], Date.now()).run();
  return { eventId, otherEventId, users, cookies };
}
const request = (eventId: string, cookie: string, body?: object, method = "POST") => SELF.fetch(`https://example.com/api/events/${eventId}/live-cutin`, { method, headers: { cookie, Origin: "https://example.com", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

describe("event-scoped cut-in action", () => {
  it("replaces rapid manual actions last-wins and cannot rewind independent scene/LIVE writes", async () => {
    const f = await fixture();
    const first = await (await request(f.eventId, f.cookies[0], { message: "  山田   参戦！！ " })).json() as { actionId: string; message: string; issuedAt: number; expiresAt: number };
    const stateUrl = `https://example.com/api/events/${f.eventId}/live-state`;
    const patch = (payload: object) => SELF.fetch(stateUrl, { method: "PATCH", headers: { cookie: f.cookies[0], "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const [scene, off, secondResponse] = await Promise.all([patch({ activeSceneId: "scene-two" }), patch({ liveIndicatorOn: false }), request(f.eventId, f.cookies[0], { message: "二番目 参戦！！" })]);
    expect([scene.status, off.status, secondResponse.status]).toEqual([200, 200, 201]);
    const second = await secondResponse.json() as { actionId: string; issuedAt: number; expiresAt: number };
    expect(first.message).toBe("山田 参戦！！");
    expect(second.actionId).not.toBe(first.actionId);
    expect(first.expiresAt - first.issuedAt).toBe(8000);
    expect((await (await request(f.eventId, f.cookies[0], undefined, "GET")).json() as { action: { actionId: string } }).action.actionId).toBe(second.actionId);
    expect(await (await SELF.fetch(stateUrl, { headers: { cookie: f.cookies[0] } })).json()).toMatchObject({ activeSceneId: "scene-two", liveIndicatorOn: false });
    expect((await (await request(f.otherEventId, f.cookies[0], undefined, "GET")).json() as { action: unknown }).action).toBeNull();
  });
  it("clears expired current columns on next authorized GET, but never clears a newer action", async () => {
    const f = await fixture();
    await request(f.eventId, f.cookies[0], { message: "old" });
    await env.DB.prepare("UPDATE event_live_state SET cutin_expires_at=? WHERE event_id=?").bind(Date.now() - 1, f.eventId).run();
    expect((await (await request(f.eventId, f.cookies[0], undefined, "GET")).json() as { action: unknown }).action).toBeNull();
    const cleared = await env.DB.prepare("SELECT cutin_action_id, cutin_message FROM event_live_state WHERE event_id=?").bind(f.eventId).first();
    expect(cleared).toMatchObject({ cutin_action_id: null, cutin_message: null });
    const next = await (await request(f.eventId, f.cookies[0], { message: "new" })).json() as { actionId: string };
    expect((await (await request(f.eventId, f.cookies[0], undefined, "GET")).json() as { action: { actionId: string } }).action.actionId).toBe(next.actionId);
  });
  it("rejects nonstaff, pending staff, admin bypass, revoked staff and invalid display text", async () => {
    const f = await fixture();
    expect((await SELF.fetch(`https://example.com/api/events/${f.eventId}/live-cutin`, { method: "POST", headers: { cookie: f.cookies[0], Origin: "https://attacker.example", "Content-Type": "application/json" }, body: JSON.stringify({ message: "no" }) })).status).toBe(403);
    expect((await request(f.eventId, f.cookies[3], { message: "no" })).status).toBe(403);
    expect((await request(f.eventId, f.cookies[2], { message: "no" })).status).toBe(403);
    expect((await request(f.otherEventId, f.cookies[1], { message: "cross event" })).status).toBe(403);
    expect((await request(f.otherEventId, f.cookies[1], undefined, "GET")).status).toBe(403);
    await env.DB.prepare("UPDATE user SET discord_id='dev-user' WHERE id=?").bind(f.users[2]).run();
    expect((await request(f.eventId, f.cookies[2], { message: "no" })).status).toBe(403);
    expect((await request(f.eventId, f.cookies[2], undefined, "GET")).status).toBe(403);
    for (const message of ["", "x".repeat(41), "A\nB", "<img>", "https://example.com"]) expect((await request(f.eventId, f.cookies[0], { message })).status).toBe(400);
    await env.DB.prepare("UPDATE event_member SET status='canceled' WHERE event_id=? AND user_id=?").bind(f.eventId, f.users[0]).run();
    expect((await request(f.eventId, f.cookies[0], undefined, "GET")).status).toBe(403);
    expect((await request(f.eventId, f.cookies[0], { message: "no" })).status).toBe(403);
    // Even a caller that bypasses the route precheck cannot write after revocation.
    await expect(eventLiveCutinRepo.trigger(f.eventId, f.users[0], "denied")).rejects.toMatchObject({ status: 409 });
    expect((await env.DB.prepare("SELECT cutin_message FROM event_live_state WHERE event_id=?").bind(f.eventId).first())?.cutin_message ?? null).toBeNull();
  });
  it("0097 adds only nullable current-action columns to the existing row", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(event_live_state)").all<{ name: string }>();
    expect(columns.results.map(row => row.name)).toEqual(expect.arrayContaining(["cutin_action_id", "cutin_message", "cutin_issued_at", "cutin_expires_at"]));
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'event_live_cutin%'").all();
    expect(tables.results).toHaveLength(0);
  });
});
