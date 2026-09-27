import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { bindEnv, type Env } from "../src/runtime.js";
import { eventLiveStateRepo } from "../src/db/repositories/eventLiveState.js";

beforeAll(() => bindEnv(env as unknown as Env));
async function fixture() {
  const staff = crypto.randomUUID(), outsider = crypto.randomUUID(), eventId = crypto.randomUUID(), sid = crypto.randomUUID();
  for (const id of [staff, outsider]) await env.DB.prepare("INSERT INTO user(id, discord_id, username, global_name, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, `nostr:${id}`, id, id, Date.now()).run();
  await env.DB.prepare("INSERT INTO session(id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, staff, Date.now() + 86400000).run();
  await env.DB.prepare("INSERT INTO event(id, title, description, starts_at, ends_at, venue_type, participation_type, status, created_by, created_at) VALUES (?, 'live', '', ?, ?, 'online', 'individual', 'published', ?, ?)").bind(eventId, Date.now() + 100000, Date.now() + 200000, staff, Date.now()).run();
  await env.DB.prepare("INSERT INTO event_member(id, event_id, user_id, role, status, attended, created_at) VALUES (?, ?, ?, 'staff', 'confirmed', 0, ?)").bind(crypto.randomUUID(), eventId, staff, Date.now()).run();
  return { staff, outsider, eventId, cookie: `eventer_session=${sid}` };
}
describe("visual style creation", () => {
  it("creates seven editable owned scenes, preserves default and rejects foreign clone", async () => {
    const f = await fixture();
    const post = (body: object) => SELF.fetch("https://example.com/api/live-sets", { method: "POST", headers: { cookie: f.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const normal = await post({ name: "legacy" });
    expect(normal.status).toBe(201);
    const plain = await normal.json() as { content: { scenes: { id: string }[] } };
    expect(plain.content.scenes[0].id).toBe("tpl-wait");
    for (const templateId of ["glow", "signal"]) {
      const response = await post({ templateId, name: templateId });
      expect(response.status).toBe(201);
      const created = await response.json() as { id: string; ownerId: string; content: { scenes: { elements: unknown[] }[] } };
      expect(created.ownerId).toBe(f.staff);
      expect(created.content.scenes).toHaveLength(7);
      expect(created.content.scenes[2].elements.length).toBeGreaterThan(5);
      expect((await SELF.fetch(`https://example.com/api/live-sets/${created.id}`, { headers: { cookie: f.cookie } })).status).toBe(200);
      const patch = (body: object) => SELF.fetch(`https://example.com/api/live-sets/${created.id}`, { method: "PATCH", headers: { cookie: f.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect((await patch({ content: plain.content })).status).toBe(409); // old editor cannot erase visual elements
      const saved = await patch({ baseUpdatedAt: (await (await SELF.fetch(`https://example.com/api/live-sets/${created.id}`, { headers: { cookie: f.cookie } })).json() as {updatedAt:number}).updatedAt, content: created.content });
      expect(saved.status).toBe(200);
      expect((await patch({ baseUpdatedAt: 1, content: created.content })).status).toBe(409);
    }
    expect((await post({ baseLiveSetId: plain.content.scenes[0].id, templateId: "glow" })).status).not.toBe(201);
    expect((await post({ baseLiveSetId: "another-owner-set" })).status).toBe(404);
  });
});

describe("manual live indicator state", () => {
  it("defaults OFF, rejects outsider and persists confirmed staff ON", async () => {
    const f = await fixture();
    expect((await eventLiveStateRepo.getOrInit(f.eventId)).liveIndicatorOn).toBe(false);
    const path = `https://example.com/api/events/${f.eventId}/live-state`;
    expect((await SELF.fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liveIndicatorOn: true }) })).status).not.toBe(200);
    const response = await SELF.fetch(path, { method: "PATCH", headers: { cookie: f.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ liveIndicatorOn: true }) });
    expect(response.status).toBe(200);
    expect((await eventLiveStateRepo.getOrInit(f.eventId)).liveIndicatorOn).toBe(true);
    await env.DB.prepare("UPDATE event_member SET status='canceled' WHERE event_id=? AND user_id=?").bind(f.eventId, f.staff).run();
    expect((await SELF.fetch(path, { method: "PATCH", headers: { cookie: f.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ liveIndicatorOn: false }) })).status).toBe(403);
    expect((await eventLiveStateRepo.getOrInit(f.eventId)).liveIndicatorOn).toBe(true);
  });
  it("interleaved scene and LIVE PATCH preserve both, including BGM", async () => {
    const f = await fixture();
    const writer = { eventId: f.eventId, actorId: f.staff, permission: "manager" as const };
    await eventLiveStateRepo.update(f.eventId, { bgmVolume: 0.7, bgmPlaying: true }, writer);
    const first = eventLiveStateRepo.update(f.eventId, { activeSceneId: "scene-2" }, writer);
    const second = eventLiveStateRepo.update(f.eventId, { liveIndicatorOn: true }, writer);
    const third = eventLiveStateRepo.update(f.eventId, { bgmPlaying: false, deckPage: 3 }, writer);
    await Promise.all([first, second, third]);
    expect(await eventLiveStateRepo.getOrInit(f.eventId)).toMatchObject({ activeSceneId: "scene-2", liveIndicatorOn: true, bgmVolume: 0.7, bgmPlaying: false, deckPage: 3 });
  });
});
