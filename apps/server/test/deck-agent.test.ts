import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";

/** docs/agent-deck-token.md: a temporary token lets an AI agent write exactly one deck. */
const BASE = "https://example.com";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

async function user() {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, 'test', ?)").bind(id, `test:${id}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${sid}` };
}
async function issue(cookie: string) {
  const res = await SELF.fetch(`${BASE}/api/decks/agent-tokens`, { method: "POST", headers: { cookie, origin: BASE } });
  expect(res.status).toBe(201);
  return res.json<{ id: string; token: string; specUrl: string; expiresAt: number; createdAt: number; deck: null }>();
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
function deck(title: string, elements: object[] = [{ type: "image-placeholder", x: 0, y: 0, w: 400, h: 300 }]) {
  return JSON.stringify({ format: "events-lab-deck", version: 2, title, slides: [{ background: "#FFFFFF", elements: [
    { type: "text", x: 40, y: 400, w: 880, h: 100, text: title, fontSize: 40, font: "default", color: "#111111", bold: true, italic: false, align: "left" },
    ...elements,
  ] }] });
}
const put = (token: string, body: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}/api/agent/deck`, { method: "PUT", headers: { ...bearer(token), "content-type": "application/json", ...headers }, body });
const upload = (token: string, body: Uint8Array = PNG, type = "image/png") =>
  SELF.fetch(`${BASE}/api/agent/deck/images`, { method: "POST", headers: { ...bearer(token), "content-type": type }, body });
const ownedDecks = async (owner: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM deck WHERE owner_id = ?").bind(owner).first<{ n: number }>())!.n;

describe("AI agent deck token (docs/agent-deck-token.md)", () => {
  it("creates one deck, uploads an image, rewrites the same deck to show it", async () => {
    const u = await user();
    const t = await issue(u.cookie);
    expect(t.token).toMatch(/^evd_[A-Za-z0-9_-]{43}$/);
    expect(t.specUrl).toBe("http://localhost/deck-import/agent.md");
    expect(t.expiresAt - t.createdAt).toBe(60 * 60 * 1000);
    // only the hash is stored
    const stored = await env.DB.prepare("SELECT token_hash FROM deck_agent_token WHERE id = ?").bind(t.id).first<{ token_hash: string }>();
    expect(stored!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.token_hash).not.toContain(t.token.slice(4));

    expect((await upload(t.token)).status).toBe(409); // deck_not_created

    const created = await put(t.token, deck("first"));
    expect(created.status).toBe(201);
    const c1 = await created.json<{ created: boolean; id: string; slug: string; viewUrl: string; editUrl: string }>();
    expect(c1).toMatchObject({ created: true, viewUrl: `http://localhost/d/${c1.slug}`, editUrl: `http://localhost/decks/${c1.id}/edit` });

    const up = await upload(t.token);
    expect(up.status).toBe(201);
    const { src } = await up.json<{ src: string }>();
    expect(src).toMatch(new RegExp(`^/api/decks/${c1.id}/images/[0-9a-f-]{36}$`));
    const img = await SELF.fetch(`${BASE}${src}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);

    const replaced = await put(t.token, deck("second", [{ type: "image-url", x: 0, y: 0, w: 400, h: 300, src }]));
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ created: false, id: c1.id, slug: c1.slug });
    const pub = await (await SELF.fetch(`${BASE}/api/public/decks/${c1.slug}`)).json<{ title: string; ownerId: string; content: { slides: { elements: { type: string; src?: string }[] }[] } }>();
    expect(pub.title).toBe("second");
    expect(pub.ownerId).toBe(u.id);
    expect(pub.content.slides[0].elements[1]).toMatchObject({ type: "image", src });
    expect(await ownedDecks(u.id)).toBe(1);

    const list = await (await SELF.fetch(`${BASE}/api/decks/agent-tokens`, { headers: { cookie: u.cookie } })).json<{ tokens: { id: string; writeCount: number; imageCount: number; deck: { id: string } | null }[] }>();
    expect(list.tokens).toEqual([expect.objectContaining({ id: t.id, writeCount: 2, imageCount: 1, deck: expect.objectContaining({ id: c1.id, title: "second" }) })]);
    const state = await (await SELF.fetch(`${BASE}/api/agent/deck`, { headers: bearer(t.token) })).json<{ writesLeft: number; imagesLeft: number; deck: { id: string } }>();
    expect(state).toMatchObject({ writesLeft: 98, imagesLeft: 49, deck: { id: c1.id } });
  });

  it("the token authenticates nowhere but /api/agent, and the agent endpoints ignore cookies", async () => {
    const u = await user();
    const t = await issue(u.cookie);
    for (const path of ["/api/decks/mine", "/api/me", "/api/decks/agent-tokens", `/api/decks/${crypto.randomUUID()}`]) {
      expect((await SELF.fetch(`${BASE}${path}`, { headers: bearer(t.token) })).status, path).toBe(401);
    }
    const me = await SELF.fetch(`${BASE}/api/auth/me`, { headers: bearer(t.token) });
    expect(JSON.stringify(await me.json())).not.toContain(u.id);
    // issuing with the Bearer token is impossible
    expect((await SELF.fetch(`${BASE}/api/decks/agent-tokens`, { method: "POST", headers: { ...bearer(t.token), origin: BASE } })).status).toBe(401);
    // a session cookie alone does not open the agent API
    expect((await SELF.fetch(`${BASE}/api/agent/deck`, { headers: { cookie: u.cookie } })).status).toBe(401);
    for (const auth of ["", "Bearer ", "Bearer evd_short", `Basic ${t.token}`, `Bearer ${t.token}x`]) {
      expect((await SELF.fetch(`${BASE}/api/agent/deck`, { headers: { authorization: auth } })).status).toBe(401);
    }
  });

  it("rewrites only its own deck; other decks and image paths are rejected", async () => {
    const u = await user();
    const t = await issue(u.cookie);
    const other = await (await SELF.fetch(`${BASE}/api/decks`, { method: "POST", headers: { cookie: u.cookie, "content-type": "application/json" }, body: JSON.stringify({ title: "mine" }) })).json<{ id: string }>();
    const c1 = await (await put(t.token, deck("bound"))).json<{ id: string }>();
    expect(c1.id).not.toBe(other.id);
    // a src under another deck, or an image that was never uploaded, is a validation error
    const foreign = await put(t.token, deck("x", [{ type: "image-url", x: 0, y: 0, w: 400, h: 300, src: `/api/decks/${other.id}/images/${crypto.randomUUID()}` }]));
    expect(foreign.status).toBe(422);
    // an uploaded image id is still only valid under the token's own deck path
    const { src: own } = await (await upload(t.token)).json<{ src: string }>();
    const swapped = await put(t.token, deck("x", [{ type: "image-url", x: 0, y: 0, w: 400, h: 300, src: own.replace(c1.id, other.id) }]));
    expect(swapped.status).toBe(422);
    const missing = await put(t.token, deck("x", [{ type: "image-url", x: 0, y: 0, w: 400, h: 300, src: `/api/decks/${c1.id}/images/${crypto.randomUUID()}` }]));
    expect(missing.status).toBe(422);
    expect(JSON.stringify(await missing.json())).toContain("image_not_uploaded");
    expect((await env.DB.prepare("SELECT title FROM deck WHERE id = ?").bind(other.id).first<{ title: string }>())!.title).toBe("mine");
    expect((await env.DB.prepare("SELECT title FROM deck WHERE id = ?").bind(c1.id).first<{ title: string }>())!.title).toBe("bound");
  });

  it("returns actionable validation errors without writing", async () => {
    const u = await user();
    const t = await issue(u.cookie);
    expect((await put(t.token, deck("x"), { "content-type": "text/plain" })).status).toBe(415);
    expect((await put(t.token, "```json\n{}\n```")).status).toBe(400);
    const bad = await put(t.token, deck("x", [{ type: "image-placeholder", x: 900, y: 0, w: 100, h: 100 }]));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "invalid_deck_import", issues: [expect.objectContaining({ code: "out_of_bounds" })] });
    const v1 = await put(t.token, deck("x").replace('"version":2', '"version":1'));
    expect(v1.status).toBe(422);
    expect(await ownedDecks(u.id)).toBe(0);
    expect((await put(t.token, " ".repeat(1048577))).status).toBe(413);
  });

  it("image upload checks type, magic bytes and size", async () => {
    const u = await user();
    const t = await issue(u.cookie);
    await put(t.token, deck("img"));
    expect((await upload(t.token, PNG, "image/svg+xml")).status).toBe(415);
    expect((await upload(t.token, new TextEncoder().encode("not a png at all"), "image/png")).status).toBe(415);
    expect((await upload(t.token, new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(6 * 1024 * 1024 + 1); big.set(PNG);
    expect((await upload(t.token, big)).status).toBe(413);
  });

  it("expired, revoked, deleted-deck and deleted-account tokens stop working", async () => {
    const u = await user();
    const expired = await issue(u.cookie);
    await env.DB.prepare("UPDATE deck_agent_token SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, expired.id).run();
    expect((await put(expired.token, deck("x"))).status).toBe(401);

    const revoked = await issue(u.cookie);
    const del = await SELF.fetch(`${BASE}/api/decks/agent-tokens/${revoked.id}`, { method: "DELETE", headers: { cookie: u.cookie, origin: BASE } });
    expect(del.status).toBe(200);
    expect((await put(revoked.token, deck("x"))).status).toBe(401);
    // another user cannot revoke someone else's token
    const stranger = await user();
    const live = await issue(u.cookie);
    expect((await SELF.fetch(`${BASE}/api/decks/agent-tokens/${live.id}`, { method: "DELETE", headers: { cookie: stranger.cookie, origin: BASE } })).status).toBe(404);
    // cross-site revoke/issue are refused
    expect((await SELF.fetch(`${BASE}/api/decks/agent-tokens/${live.id}`, { method: "DELETE", headers: { cookie: u.cookie, origin: "https://evil.example" } })).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/api/decks/agent-tokens`, { method: "POST", headers: { cookie: u.cookie } })).status).toBe(403);

    const c1 = await (await put(live.token, deck("x"))).json<{ id: string }>();
    await SELF.fetch(`${BASE}/api/decks/${c1.id}`, { method: "DELETE", headers: { cookie: u.cookie } });
    expect((await put(live.token, deck("again"))).status).toBe(410);
    expect((await upload(live.token)).status).toBe(410);
    expect(await ownedDecks(u.id)).toBe(0);

    const before = await issue(u.cookie);
    await accountDeletionRepo.requestDeletion(u.id, Date.now());
    expect((await put(before.token, deck("x"))).status).toBe(401);
    const row = await env.DB.prepare("SELECT revoked_at FROM deck_agent_token WHERE id = ?").bind(before.id).first<{ revoked_at: number | null }>();
    expect(row!.revoked_at).not.toBeNull();
  });

  it("caps issuance per day and writes per token", async () => {
    const u = await user();
    const t = await issue(u.cookie);
    await put(t.token, deck("x"));
    await env.DB.prepare("UPDATE deck_agent_token SET write_count = 100 WHERE id = ?").bind(t.id).run();
    expect((await put(t.token, deck("y"))).status).toBe(429);
    for (let i = 1; i < 20; i++) await issue(u.cookie);
    const over = await SELF.fetch(`${BASE}/api/decks/agent-tokens`, { method: "POST", headers: { cookie: u.cookie, origin: BASE } });
    expect(over.status).toBe(429);
  });
});
