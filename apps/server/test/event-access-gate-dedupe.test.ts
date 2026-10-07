import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { EventLiveStateWithCutin } from "@eventer/shared";
import { app } from "../src/worker.js";
import { bindEnv, type Env } from "../src/runtime.js";

/**
 * D-POLL-MIN Phase 2: the common gate (requireEventAccess) reads the event once
 * and handlers reuse it.
 *
 * - S1: the gate reads the light row (`SELECT * FROM event WHERE id = ?`), skips the
 *   post-handler access re-check for GET/HEAD, and re-checks mutations with the
 *   access query alone (#526: the response is still replaced when access was lost).
 * - S2/S3/S8: handlers do not read the event or the caller's member row again.
 * - S7: GET /live-state carries the cut-in for the OBS screen.
 *
 * Requests go through `app.fetch` with a D1 wrapper that records every statement,
 * so the tests can count which SQL ran for one request.
 */

const BASE = "https://example.com";
const DAY = 86_400_000;
const LIGHT_EVENT = "SELECT * FROM event WHERE id = ?";
const HEAVY_EVENT = "AS participant_count";
const ACCESS = "AS allowed FROM event e WHERE e.id = ?";
const MEMBER = "SELECT * FROM event_member WHERE event_id = ? AND user_id = ? AND status <> 'canceled'";

let statements: string[] = [];

function recordingDb(db: D1Database): D1Database {
  const wrap = (stmt: any, sql: string): any => ({
    __raw: stmt,
    bind: (...args: unknown[]) => wrap(stmt.bind(...args), sql),
    first: (col?: string) => { statements.push(sql); return stmt.first(col); },
    all: () => { statements.push(sql); return stmt.all(); },
    run: () => { statements.push(sql); return stmt.run(); },
    raw: (o?: unknown) => { statements.push(sql); return stmt.raw(o); },
  });
  return {
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    batch: (list: any[]) => { statements.push(...list.map(() => "<batch>")); return db.batch(list.map((s) => s.__raw)); },
    exec: (sql: string) => db.exec(sql),
    dump: () => db.dump(),
  } as unknown as D1Database;
}

const recordingEnv = () => ({ ...(env as unknown as Env), DB: recordingDb(env.DB) }) as Env;

/** One request through the real router; returns the response and the SQL it ran. */
async function call(path: string, cookie: string | null, method = "GET", body?: unknown) {
  const e = recordingEnv();
  bindEnv(e);
  statements = [];
  const res = await app.fetch(new Request(`${BASE}/api/events/${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json", Origin: BASE },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), e);
  const ran = [...statements];
  bindEnv(env as unknown as Env);
  return { res, ran, count: (needle: string) => ran.filter((s) => s.includes(needle)).length };
}

async function sql(query: string, ...args: unknown[]) {
  await env.DB.prepare(query).bind(...args).run();
}

async function makeUser(admin = false) {
  const id = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await sql("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, ?)", id, admin ? "dev-user" : `nostr:${id}`, `g_${id.slice(0, 8)}`, Date.now());
  await sql("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)", sid, id, Date.now() + DAY);
  return { id, cookie: `eventer_session=${sid}` };
}

async function makeEvent(owner: string, opts: { status?: string; visibility?: string } = {}) {
  const id = crypto.randomUUID();
  await sql(`INSERT INTO event (id, title, description, starts_at, ends_at, venue_type, participation_type,
      status, visibility, created_by, created_at, chat_enabled, qa_enabled)
    VALUES (?, 'gate', '', ?, ?, 'online', 'individual', ?, ?, ?, ?, 1, 1)`,
  id, Date.now() - 3_600_000, Date.now() + DAY, opts.status ?? "published", opts.visibility ?? "public", owner, Date.now());
  return id;
}

async function addMember(eventId: string, userId: string, role = "participant", status = "confirmed") {
  await sql(`INSERT INTO event_member (id, event_id, user_id, role, status, attended, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET role = excluded.role, status = excluded.status`,
  crypto.randomUUID(), eventId, userId, role, status, Date.now());
}

let staff: { id: string; cookie: string };
let member: { id: string; cookie: string };
let outsider: { id: string; cookie: string };

beforeAll(async () => {
  bindEnv(env as unknown as Env);
  staff = await makeUser();
  member = await makeUser();
  outsider = await makeUser();
});

describe("requireEventAccess: one light event read, post-check only for mutations (S1)", () => {
  it("GET reads the light row once, runs the access query once, and never the counted findById", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, staff.id, "staff");
    const r = await call(`${eventId}/state`, staff.cookie);
    expect(r.res.status).toBe(200);
    expect(r.count(LIGHT_EVENT)).toBe(1);
    expect(r.count(ACCESS)).toBe(1); // no post-handler re-check for GET
    expect(r.count(HEAVY_EVENT)).toBe(0);
  });

  it("HEAD skips the post-handler re-check too", async () => {
    const eventId = await makeEvent(staff.id);
    const r = await call(`${eventId}/state`, null, "HEAD");
    expect(r.count(ACCESS)).toBe(1);
  });

  it("a mutation re-checks access after the handler, with the access query and not findById", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, staff.id, "staff");
    const r = await call(`${eventId}/criteria`, staff.cookie, "POST", { name: "表現" });
    expect(r.res.status).toBe(201);
    expect(r.count(ACCESS)).toBe(2);
    expect(r.count(LIGHT_EVENT)).toBe(1);
    expect(r.count(HEAVY_EVENT)).toBe(0);
  });

  it("#526: a mutation that loses access mid-request is answered with the same 404 (self-leave keeps {ok:true})", async () => {
    const eventId = await makeEvent(staff.id, { visibility: "unlisted", status: "draft" });
    await addMember(eventId, staff.id, "staff");
    await addMember(eventId, member.id);
    // Leaving a draft removes the only source of viewing for this member.
    const left = await call(`${eventId}/join`, member.cookie, "DELETE");
    expect(left.res.status).toBe(200);
    expect(await left.res.json()).toEqual({ ok: true });
    expect(left.count(ACCESS)).toBe(2);
    const after = await call(eventId, member.cookie);
    expect(after.res.status).toBe(404);
  });

  it.each([
    ["private, not invited", { status: "published", visibility: "private" }],
    ["unlisted draft, not a member", { status: "draft", visibility: "unlisted" }],
    ["public draft, not a member", { status: "draft", visibility: "public" }],
  ])("denies %s with the same 404 for GET and mutations", async (_label, opts) => {
    const eventId = await makeEvent(staff.id, opts);
    for (const [path, method] of [["", "GET"], ["/state", "GET"], ["/chat-members", "GET"], ["/questions", "GET"], ["/live-state", "GET"], ["/criteria", "POST"]] as const) {
      const r = await call(`${eventId}${path}`, outsider.cookie, method, method === "POST" ? { name: "x" } : undefined);
      expect(r.res.status, `${method} ${path}`).toBe(404);
      expect(await r.res.json()).toEqual({ error: "not_found" });
      expect(r.res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("a deleted (blocked) account is denied like before", async () => {
    const eventId = await makeEvent(staff.id, { visibility: "private" });
    const gone = await makeUser();
    await addMember(eventId, gone.id, "staff");
    expect((await call(eventId, gone.cookie)).res.status).toBe(200);
    await sql("UPDATE user SET deleted_at = ? WHERE id = ?", Date.now(), gone.id);
    expect((await call(eventId, gone.cookie)).res.status).toBe(404);
  });
});

describe("handlers reuse the gate's event and member rows (S2/S3/S8)", () => {
  it("the detail GET still returns the counts, reading findById exactly once", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, staff.id, "staff");
    await addMember(eventId, member.id);
    const r = await call(eventId, member.cookie);
    expect(r.res.status).toBe(200);
    const body = await r.res.json() as { event: { participantCount: number; attendedCount: number; capacityTotal: number | null } };
    expect(body.event).toMatchObject({ participantCount: 2, attendedCount: 0, capacityTotal: null });
    expect(r.count(HEAVY_EVENT)).toBe(1);
    expect(r.count(ACCESS)).toBe(1);
  });

  it("child lists (members) read no event row besides the gate's", async () => {
    const eventId = await makeEvent(staff.id);
    const r = await call(`${eventId}/members`, null);
    expect(r.res.status).toBe(200);
    expect(r.count(HEAVY_EVENT)).toBe(0);
    expect(r.count(LIGHT_EVENT)).toBe(1);
  });

  it("chat-members reads the member row once and the event once", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, member.id);
    const r = await call(`${eventId}/chat-members`, member.cookie);
    expect(r.res.status).toBe(200);
    expect(r.count(MEMBER)).toBe(1);
    expect(r.count(LIGHT_EVENT)).toBe(1);
    expect(r.count(HEAVY_EVENT)).toBe(0);
  });

  it("questions reads the member row once and no counted event", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, member.id);
    const r = await call(`${eventId}/questions`, member.cookie);
    expect(r.res.status).toBe(200);
    expect(await r.res.json()).toMatchObject({ qaEnabled: true, canPost: true, canModerate: false });
    expect(r.count(MEMBER)).toBe(1);
    expect(r.count(HEAVY_EVENT)).toBe(0);
  });
});

describe("chat endpoints still enforce confirmed and blocked", () => {
  it.each(["applied", "waitlisted"])("a %s member gets 403 from chat-members and the ephemeral key", async (status) => {
    const eventId = await makeEvent(staff.id);
    const pending = await makeUser();
    await addMember(eventId, pending.id, "participant", status);
    expect((await call(`${eventId}/chat-members`, pending.cookie)).res.status).toBe(403);
    expect((await call(`${eventId}/chat-key/ephemeral`, pending.cookie)).res.status).toBe(403);
    expect((await call(`${eventId}/questions`, pending.cookie)).res.status).toBe(403);
  });

  it("a blocked confirmed member gets chat_unavailable", async () => {
    const eventId = await makeEvent(staff.id);
    const noisy = await makeUser();
    await addMember(eventId, noisy.id);
    const pubkey = "b".repeat(64);
    await sql("INSERT INTO event_chat_key (event_id, user_id, pubkey, created_at) VALUES (?, ?, ?, ?)", eventId, noisy.id, pubkey, Date.now());
    expect((await call(`${eventId}/chat-members`, noisy.cookie)).res.status).toBe(200);
    await sql("INSERT INTO event_chat_blocked (event_id, pubkey, created_by, created_at) VALUES (?, ?, ?, ?)", eventId, pubkey, staff.id, Date.now());
    const r = await call(`${eventId}/chat-members`, noisy.cookie);
    expect(r.res.status).toBe(403);
    expect(await r.res.json()).toEqual({ error: "chat_unavailable" });
  });

  it("staff-only chat operations still require a confirmed event staff member", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, staff.id, "staff", "applied");
    await addMember(eventId, member.id);
    const hide = { noteId: "c".repeat(64) };
    expect((await call(`${eventId}/chat-hidden`, staff.cookie, "POST", hide)).res.status).toBe(403);
    expect((await call(`${eventId}/chat-hidden`, member.cookie, "POST", hide)).res.status).toBe(403);
    await addMember(eventId, staff.id, "staff", "confirmed");
    expect((await call(`${eventId}/chat-hidden`, staff.cookie, "POST", hide)).res.status).toBe(200);
  });

  it("plaintext chat stays closed on a non-public event", async () => {
    const eventId = await makeEvent(staff.id, { visibility: "unlisted" });
    await addMember(eventId, member.id);
    const r = await call(`${eventId}/chat-members`, member.cookie);
    expect(r.res.status).toBe(403);
    expect(await r.res.json()).toEqual({ error: "chat_unavailable" });
  });
});

describe("GET /live-state carries the cut-in (S7)", () => {
  it("confirmed staff get the current cut-in in live-state, with one member read", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, staff.id, "staff");
    const none = await call(`${eventId}/live-state`, staff.cookie);
    expect(none.res.status).toBe(200);
    expect((await none.res.json() as EventLiveStateWithCutin).cutin).toMatchObject({ action: null });
    const trigger = await call(`${eventId}/live-cutin`, staff.cookie, "POST", { message: "参戦！！" });
    expect(trigger.res.status).toBe(201);
    const { actionId } = await trigger.res.json() as { actionId: string };
    const r = await call(`${eventId}/live-state`, staff.cookie);
    const body = await r.res.json() as EventLiveStateWithCutin;
    expect(body).toMatchObject({ eventId, chatSource: "off", cutin: { action: { actionId, message: "参戦！！" } } });
    expect(typeof body.cutin?.serverNow).toBe("number");
    expect(r.count(MEMBER)).toBe(1);
    // The old endpoint still answers the same action for cached bundles.
    const old = await call(`${eventId}/live-cutin`, staff.cookie);
    expect(old.res.status).toBe(200);
    expect((await old.res.json() as { action: { actionId: string } }).action.actionId).toBe(actionId);
  });

  it("an app admin who is not confirmed staff gets live-state with cutin null, like the 403 on /live-cutin", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, staff.id, "staff");
    await call(`${eventId}/live-cutin`, staff.cookie, "POST", { message: "見えない" });
    const admin = await makeUser(true);
    const r = await call(`${eventId}/live-state`, admin.cookie);
    expect(r.res.status).toBe(200);
    expect((await r.res.json() as EventLiveStateWithCutin).cutin).toBeNull();
    expect((await call(`${eventId}/live-cutin`, admin.cookie)).res.status).toBe(403);
  });

  it("participants still get 403 from live-state", async () => {
    const eventId = await makeEvent(staff.id);
    await addMember(eventId, member.id);
    expect((await call(`${eventId}/live-state`, member.cookie)).res.status).toBe(403);
  });
});
