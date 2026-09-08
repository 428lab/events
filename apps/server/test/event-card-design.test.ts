import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createCardTemplate, type CardDesign, type SavedCardDesign } from "@eventer/shared";

const base = "https://example.com";
async function setup() {
  const login = await SELF.fetch(`${base}/api/auth/dev-login`, { method: "POST" });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const result = await SELF.fetch(`${base}/api/events`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: "Card editor", venueType: "offline", startsAt: 1, endsAt: 99999999999999 }),
  });
  expect(result.status).toBe(201);
  const { event } = await result.json() as { event: { id: string } };
  return { cookie, eventId: event.id };
}
function request(eventId: string, cookie?: string, design?: CardDesign, revision = 0) {
  return SELF.fetch(`${base}/api/events/${eventId}/name-card-design`, {
    method: design ? "PUT" : "GET",
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: design ? JSON.stringify({ revision, design }) : undefined,
  });
}
async function member(eventId: string, role: string, status: string) {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, `nostr:${id}`, `u_${id.slice(0, 8)}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(session, id, Date.now() + 86400000).run();
  await env.DB.prepare("INSERT INTO event_member (id, event_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), eventId, id, role, status, Date.now()).run();
  return `eventer_session=${session}`;
}
async function asset(eventId: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO event_card_asset
    (id, event_id, object_key, content_type, ready, width, height, created_at) VALUES (?, ?, ?, 'image/png', 1, 10, 10, ?)`)
    .bind(id, eventId, `card-designs/${eventId}/${id}`, Date.now()).run();
  return id;
}

const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII="), c => c.charCodeAt(0));

async function upload(eventId: string, cookie: string, mime = "image/png", body = png) {
  return SELF.fetch(`${base}/api/events/${eventId}/name-card-assets`, {
    method: "POST", headers: { cookie, "content-type": mime }, body,
  });
}

describe("event-only card documents (#506)", () => {
  it("starts with the legacy fallback and persists edits without touching personal cards", async () => {
    const { eventId, cookie } = await setup();
    expect(await (await request(eventId, cookie)).json()).toEqual({ revision: 0, design: null });
    const before = await env.DB.prepare("SELECT id, card_image_key FROM user ORDER BY id").all();
    const design = createCardTemplate("name");
    expect((await request(eventId, cookie, design)).status).toBe(200);
    expect(await (await request(eventId, cookie)).json()).toEqual({ revision: 1, design });
    expect((await env.DB.prepare("SELECT id, card_image_key FROM user ORDER BY id").all()).results).toEqual(before.results);
  });

  it.each([["participant", "confirmed"], ["staff", "pending"]])("denies %s/%s for reading and writing", async (role, status) => {
    const { eventId } = await setup();
    const cookie = await member(eventId, role, status);
    expect((await request(eventId, cookie)).status).toBe(403);
    expect((await request(eventId, cookie, createCardTemplate("name"))).status).toBe(403);
  });

  it("does not let a site administrator bypass event staff membership", async () => {
    const { eventId, cookie } = await setup();
    await env.DB.prepare("DELETE FROM event_member WHERE event_id = ?").bind(eventId).run();
    expect((await request(eventId, cookie)).status).toBe(403);
    expect((await request(eventId, cookie, createCardTemplate("name"))).status).toBe(403);
  });

  it("requires authentication", async () => {
    const { eventId } = await setup();
    expect((await request(eventId)).status).toBe(401);
  });

  it("allows one concurrent save and preserves the winner's document and asset references", async () => {
    const { eventId, cookie } = await setup();
    const a = createCardTemplate("name"), b = createCardTemplate("profile");
    a.common.background.assetId = await asset(eventId);
    b.common.background.assetId = await asset(eventId);
    const replies = await Promise.all([request(eventId, cookie, a), request(eventId, cookie, b)]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = replies[0].status === 200 ? a : b;
    const saved = await (await request(eventId, cookie)).json() as SavedCardDesign;
    expect(saved).toEqual({ revision: 1, design: winner });
    const refs = await env.DB.prepare("SELECT asset_id FROM event_card_design_asset WHERE event_id = ?").bind(eventId).all();
    expect(refs.results).toEqual([{ asset_id: winner.common.background.assetId }]);
    expect((await request(eventId, cookie, a, 99)).status).toBe(409);
  });

  it("rejects another event's assets and nonexistent slots without saving anything", async () => {
    const owner = await setup(), other = await setup();
    const d = createCardTemplate("name");
    d.common.background.assetId = await asset(other.eventId);
    expect((await request(owner.eventId, owner.cookie, d)).status).toBe(400);
    delete d.common.background.assetId;
    d.slots = [{ slotId: "missing", rule: { parts: [], hiddenIds: [] } }];
    expect((await request(owner.eventId, owner.cookie, d)).status).toBe(400);
    expect(await (await request(owner.eventId, owner.cookie)).json()).toEqual({ revision: 0, design: null });
  });

  it("keeps images private, prevents deleting used assets, and cleans them up with the event", async () => {
    const { eventId, cookie } = await setup();
    const response = await upload(eventId, cookie);
    expect(response.status).toBe(201);
    const { asset: image } = await response.json() as { asset: { id: string; url: string } };
    const read = await SELF.fetch(`${base}${image.url}`, { headers: { cookie } });
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(png);
    const outsider = await member(eventId, "participant", "confirmed");
    const privateRead = await SELF.fetch(`${base}${image.url}`, { headers: { cookie: outsider } });
    // Drain even an unexpected successful response so an auth mutant cannot leak an R2 stream.
    await privateRead.arrayBuffer();
    expect(privateRead.status).toBe(403);
    expect((await upload(eventId, outsider)).status).toBe(403);
    const d = createCardTemplate("name"); d.common.background.assetId = image.id;
    expect((await request(eventId, cookie, d)).status).toBe(200);
    expect((await SELF.fetch(`${base}${image.url}`, { method: "DELETE", headers: { cookie } })).status).toBe(409);
    const key = `event-card-assets/${eventId}/${image.id}`;
    expect(await env.BUCKET.head(key)).not.toBeNull();
    const deleted = await SELF.fetch(`${base}/api/events/${eventId}`, { method: "DELETE", headers: { cookie } });
    expect(deleted.status).toBe(200);
    expect(await env.BUCKET.get(key)).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM event_card_design WHERE event_id = ?").bind(eventId).first()).toBeNull();
  });

  it("copies image bytes only for staff of both events and survives deleting the source", async () => {
    const source = await setup(), target = await setup();
    const response = await upload(source.eventId, source.cookie);
    const { asset: image } = await response.json() as { asset: { id: string } };
    const copy = (cookie: string) => SELF.fetch(`${base}/api/events/${target.eventId}/name-card-assets/copy`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sourceEventId: source.eventId, assetId: image.id }),
    });
    const targetOnly = await member(target.eventId, "staff", "confirmed");
    expect((await copy(targetOnly)).status).toBe(403);
    const copied = await copy(target.cookie);
    expect(copied.status).toBe(201);
    const { asset: result } = await copied.json() as { asset: { id: string; url: string } };
    expect(result.id).not.toBe(image.id);
    await SELF.fetch(`${base}/api/events/${source.eventId}`, { method: "DELETE", headers: { cookie: source.cookie } });
    const read = await SELF.fetch(`${base}${result.url}`, { headers: { cookie: target.cookie } });
    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(png);
    const d = createCardTemplate("name"); d.common.background.assetId = result.id;
    expect((await request(target.eventId, target.cookie, d)).status).toBe(200);
  });

  it("rejects SVG, MIME spoofing and excessive pixel dimensions", async () => {
    const { eventId, cookie } = await setup();
    expect((await upload(eventId, cookie, "image/svg+xml")).status).toBe(400);
    expect((await upload(eventId, cookie, "image/jpeg")).status).toBe(400);
    const huge = png.slice(); new DataView(huge.buffer).setUint32(16, 100000);
    expect((await upload(eventId, cookie, "image/png", huge)).status).toBe(400);
    const list = await SELF.fetch(`${base}/api/events/${eventId}/name-card-assets`, { headers: { cookie } });
    expect(await list.json()).toEqual({ assets: [] });
  });

  it("rejects malformed JSON instead of turning a client mistake into a server error", async () => {
    const { eventId, cookie } = await setup();
    const r = await SELF.fetch(`${base}/api/events/${eventId}/name-card-design`, {
      method: "PUT", headers: { cookie, "content-type": "application/json" }, body: "{",
    });
    expect(r.status).toBe(400);
  });
});
