import { SELF, env, createExecutionContext } from "cloudflare:test";
import worker from "../src/worker.js";
import { describe, it, expect, vi, afterEach } from "vitest";
import { deckImportRepo } from "../src/db/repositories/deckImport.js";
import { postDeckImport } from "../src/routes/deckImport.js";
import { Hono } from "hono";
import type { AppEnv } from "../src/types.js";

const BASE = "https://example.com";
const raw = JSON.stringify({ format: "events-lab-deck", version: 1, title: "Import", slides: [{ background: "#FFFFFF", elements: [{ type: "image-placeholder", x: 0, y: 0, w: 20, h: 20 }] }] });
const ownersByCookie = new Map<string, string>();
async function user() {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, 'test', ?)").bind(id, `test:${id}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, id, Date.now() + 86400000).run();
  ownersByCookie.set(`eventer_session=${sid}`, id);
  return { id, cookie: `eventer_session=${sid}` };
}
function request(cookie: string, key = crypto.randomUUID(), body = raw, headers: Record<string, string> = {}) {
  return SELF.fetch(`${BASE}/api/decks/import`, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/json", "x-deck-import-key": key, "x-deck-import-owner": ownersByCookie.get(cookie) ?? "", ...headers }, body });
}
async function count(table: "deck" | "deck_import_receipt", owner: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ?`).bind(owner).first<{ n: number }>())!.n;
}
afterEach(() => vi.restoreAllMocks());

describe("POST /api/decks/import", () => {
  it("atomically creates complete content, replays without undoing editing, conflicts, then tombstones", async () => {
    const u = await user(), key = crypto.randomUUID();
    const first = await request(u.cookie, key);
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const receipt = await first.json<{ id: string; slug: string; replayed: boolean }>();
    expect(receipt).toMatchObject({ replayed: false });
    expect(first.headers.get("location")).toBe(`/api/decks/${receipt.id}`);
    const deck = await (await SELF.fetch(`${BASE}/api/public/decks/${receipt.slug}`)).json<{ content: { slides: { elements: object[] }[] } }>();
    expect(deck.content.slides[0].elements[0]).toMatchObject({ type: "image", rotation: 0, w: 20 });
    expect(deck.content.slides[0].elements[0]).not.toHaveProperty("src");
    await env.DB.prepare("UPDATE deck SET title = 'edited' WHERE id = ?").bind(receipt.id).run();
    const replay = await request(u.cookie, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ...receipt, replayed: true });
    expect((await env.DB.prepare("SELECT title FROM deck WHERE id = ?").bind(receipt.id).first())!.title).toBe("edited");
    const conflict = await request(u.cookie, key, raw + " ");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "import_key_conflict", id: receipt.id, slug: receipt.slug });
    await SELF.fetch(`${BASE}/api/decks/${receipt.id}`, { method: "DELETE", headers: { cookie: u.cookie } });
    expect((await request(u.cookie, key)).status).toBe(410);
    expect(await count("deck", u.id)).toBe(0);
    expect(await count("deck_import_receipt", u.id)).toBe(1);
    await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(u.id).run();
    expect(await count("deck_import_receipt", u.id)).toBe(0);
  });
  it("requires authentication and enforces Origin, headers, strict server validation without writes", async () => {
    expect((await request("")).status).toBe(401);
    const u = await user();
    for (const origin of ["", "null", "https://other.example"]) expect((await request(u.cookie, undefined, raw, { origin })).status).toBe(403);
    expect((await request(u.cookie, "not-a-uuid")).status).toBe(400);
    for (const headers of [{ "content-type": "text/plain" }, { "content-type": "application/json;charset=latin1" }, { "content-encoding": "gzip" }]) {
      expect((await request(u.cookie, undefined, raw, headers)).status).toBe(415);
    }
    expect((await request(u.cookie, undefined, '{"format":1,"format":2}')).status).toBe(400);
    expect((await request(u.cookie, undefined, raw.replace('"version":1', '"version":2'))).status).toBe(422);
    expect((await request(u.cookie, undefined, " ".repeat(1048577))).status).toBe(413);
    expect(await count("deck", u.id)).toBe(0);
    expect(await count("deck_import_receipt", u.id)).toBe(0);
  });
  it("the single body gate counts bytes despite a misleading Content-Length", async () => {
    const req = new Request(`${BASE}/api/decks/import`, { method: "POST", headers: { "Content-Length": "1" }, body: " ".repeat(1048577) });
    expect(req.headers.get("Content-Length")).toBe("1");
    const res = await worker.fetch(req, env, createExecutionContext());
    expect(res.status).toBe(413);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Ordinary creation keeps the previous 8MiB gate, so this reaches auth.
    expect((await SELF.fetch(`${BASE}/api/decks`, { method: "POST", body: " ".repeat(1048577) })).status).toBe(401);
  });
  it("scopes receipts to owner and refuses a mismatched target owner", async () => {
    const a = await user(), b = await user(), key = crypto.randomUUID();
    const first = await (await request(a.cookie, key)).json<{ id: string }>();
    expect((await request(b.cookie, key)).status).toBe(201);
    await env.DB.prepare("UPDATE deck SET owner_id = ? WHERE id = ?").bind(b.id, first.id).run();
    expect((await request(a.cookie, key)).status).toBe(403);
  });
  it("rejects a cached A operation sent with B's session before first create or replay", async () => {
    const a = await user(), b = await user(), key = crypto.randomUUID();
    const first = await request(b.cookie, key, raw, { "x-deck-import-owner": a.id });
    expect(first.status).toBe(403);
    expect(await first.json()).toEqual({ error: "import_owner_mismatch" });
    expect(await count("deck", b.id)).toBe(0);
    expect(await count("deck_import_receipt", b.id)).toBe(0);
    expect(await count("deck", a.id)).toBe(0);
    const missing = await request(a.cookie, key, raw, { "x-deck-import-owner": "" });
    expect(missing.status).toBe(403);
    expect(await count("deck_import_receipt", a.id)).toBe(0);
    expect((await request(a.cookie, key)).status).toBe(201);
    const retry = await request(b.cookie, key, raw, { "x-deck-import-owner": a.id });
    expect(retry.status).toBe(403);
    expect(await retry.json()).toEqual({ error: "import_owner_mismatch" });
    expect(await count("deck", b.id)).toBe(0);
    expect(await count("deck_import_receipt", b.id)).toBe(0);
    expect((await request(a.cookie, key)).status).toBe(200);
  });
  it("concurrent same-key requests converge", async () => {
    const u = await user(), key = crypto.randomUUID();
    const responses = await Promise.all([request(u.cookie, key), request(u.cookie, key)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect((await responses[0].json<{ id: string }>()).id).toBe((await responses[1].json<{ id: string }>()).id);
    expect(await count("deck", u.id)).toBe(1);
  });
  it("atomic quota rejects a new key but allows successful replays at 100", async () => {
    const u = await user(), key = crypto.randomUUID();
    await env.DB.batch(Array.from({ length: 99 }, () => env.DB.prepare("INSERT INTO deck_import_receipt VALUES (?, ?, ?, ?, ?)").bind(u.id, crypto.randomUUID(), "0".repeat(64), crypto.randomUUID(), Date.now())));
    const responses = await Promise.all([request(u.cookie, key), request(u.cookie, key)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await count("deck_import_receipt", u.id)).toBe(100);
    const denied = await request(u.cookie);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await request(u.cookie, key)).status).toBe(200);
  });
  it("account merge transfers noncolliding receipts, preserves winner collisions and all decks", async () => {
    const winner = await user(), loser = await user(), key = crypto.randomUUID();
    const a = await (await request(winner.cookie, key)).json<{ id: string }>();
    const b = await (await request(loser.cookie, key, raw + " ")).json<{ id: string }>();
    const uniqueKey = crypto.randomUUID();
    const unique = await (await request(loser.cookie, uniqueKey)).json<{ id: string }>();
    const before = await env.DB.prepare("SELECT * FROM deck_import_receipt WHERE owner_id = ? AND import_key = ?").bind(winner.id, key).first();
    const codeResponse = await SELF.fetch(`${BASE}/api/me/merge-code`, { method: "POST", headers: { cookie: loser.cookie } });
    const { code } = await codeResponse.json<{ code: string }>();
    const merged = await SELF.fetch(`${BASE}/api/me/merge`, { method: "POST", headers: { cookie: winner.cookie, "content-type": "application/json" }, body: JSON.stringify({ code, keep: "me" }) });
    expect(merged.status).toBe(200);
    expect(await count("deck", winner.id)).toBe(3);
    for (const id of [a.id, b.id, unique.id]) {
      const deck = await env.DB.prepare("SELECT owner_id, content FROM deck WHERE id = ?").bind(id).first<{ owner_id: string; content: string }>();
      expect(deck!.owner_id).toBe(winner.id);
      expect(JSON.parse(deck!.content).slides[0].elements).toHaveLength(1);
    }
    expect(await env.DB.prepare("SELECT * FROM deck_import_receipt WHERE owner_id = ? AND import_key = ?").bind(winner.id, key).first()).toEqual(before);
    expect(await env.DB.prepare("SELECT deck_id FROM deck_import_receipt WHERE owner_id = ? AND import_key = ?").bind(winner.id, uniqueKey).first()).toEqual({ deck_id: unique.id });
    expect(await count("deck_import_receipt", loser.id)).toBe(0);
    expect(await env.DB.prepare("SELECT id FROM user WHERE id = ?").bind(loser.id).first()).toBeNull();
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await request(loser.cookie, key)).status).toBe(401);
  });
  it("deck INSERT failure rolls back the preceding receipt INSERT", async () => {
    const u = await user();
    await env.DB.exec("CREATE TRIGGER fail_import_deck BEFORE INSERT ON deck BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    try {
      expect((await request(u.cookie)).status).toBe(503);
      expect(await count("deck_import_receipt", u.id)).toBe(0);
      expect(await count("deck", u.id)).toBe(0);
    } finally { await env.DB.exec("DROP TRIGGER fail_import_deck"); }
  });
});

// Deterministically force the exact 99 -> 100 interleaving: request B saw no
// receipt, A committed the final slot, B's SQL returned 0/0. Real D1 atomic SQL
// is exercised above; these cases pin classification independently of scheduling.
describe("deck import 0/0 quota race classification", () => {
  it.each(["same", "different", "deleted", "missing", "db-failure"] as const)("requeries receipt: %s", async (kind) => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), (b) => b.toString(16).padStart(2, "0")).join("");
    const find = vi.spyOn(deckImportRepo, "find").mockResolvedValueOnce(null);
    if (kind === "db-failure") find.mockRejectedValueOnce(new Error("db failure"));
    else find.mockResolvedValueOnce(kind === "missing" ? null : { payload_sha256: kind === "different" ? "other" : hash, deck_id: "created", target_id: kind === "deleted" ? null : "created", owner_id: "owner", slug: "0123456789" });
    vi.spyOn(deckImportRepo, "insert").mockResolvedValue([0, 0]);
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => { c.set("user", { id: "owner" } as AppEnv["Variables"]["user"]); await next(); });
    app.post("/api/decks/import", postDeckImport);
    const response = await app.request(`${BASE}/api/decks/import`, { method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-deck-import-key": crypto.randomUUID(), "x-deck-import-owner": "owner" }, body: raw });
    expect(response.status).toBe({ same: 200, different: 409, deleted: 410, missing: 429, "db-failure": 503 }[kind]);
    expect(find).toHaveBeenCalledTimes(2);
  });
});
