import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventBroadcastsPayload, EventSignalSource, EventSignalTopic, MeetToken, ScheduleEditingState } from "@eventer/shared";
import { SCHEDULE_EDIT_EXPIRE_MS } from "@eventer/shared";
import { eventSignal } from "../src/lib/eventSignal.js";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";
import { drainBroadcastEmails } from "../src/lib/broadcast.js";
import { bindEnv, type Env } from "../src/runtime.js";

/**
 * Refetch topics of D-POLL-MIN Phase 5b-4 (docs/event-signal.md): `meet-token` (user scope:
 * the token owner's QR screen, sent when a scan uses the token up), `schedule-editing`
 * (who is editing the timetable / the version moved) and `broadcasts` (the email queue
 * moved). Each replaces a poll; the payload names where to listen.
 */

const BASE = "https://example.com";
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  bindEnv(env as unknown as Env);
});

async function makeUser() {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,global_name,created_at) VALUES(?,?,?,?,1)", id, `nostr:${id}`, `u_${id.slice(0, 8)}`, `n_${id.slice(0, 4)}`).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}

async function setup() {
  const staff = await makeUser(), other = await makeUser(), member = await makeUser(), eventId = crypto.randomUUID(), now = Date.now();
  await sql(
    `INSERT INTO event(id,title,starts_at,ends_at,venue_type,status,visibility,scheduling,attendance_check,created_by,created_at)
     VALUES(?, 'Signal 5b-4',?,?,'offline','published','public',0,1,?,?)`,
    eventId, now - 3600_000, now + 3600_000, staff.id, now,
  ).run();
  for (const [user, role] of [[staff, "staff"], [other, "staff"], [member, "participant"]] as const) {
    await sql("INSERT INTO event_member(id,event_id,user_id,role,status,attended,created_at) VALUES(?,?,?,?,'confirmed',0,1)", crypto.randomUUID(), eventId, user.id, role).run();
  }
  return { staff, other, member, eventId };
}

const call = (method: string, path: string, cookie: string, body?: unknown) => SELF.fetch(`${BASE}/api${path}`, {
  method, headers: { "content-type": "application/json", cookie, Origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body),
});
async function read<T>(method: string, path: string, cookie: string, body?: unknown): Promise<T> {
  const res = await call(method, path, cookie, body);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

const topicOf = (scopeId: string, topic: EventSignalTopic) => eventSignal.config(scopeId, topic, 1)!.topic;

function spyPublish() {
  const sent: string[][] = [];
  vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relayUrls, signal): Promise<PublishReport> => {
    sent.push(signal.tags.filter((t) => t[0] === "t").map((t) => t[1]!));
    return { ok: true, relays: relayUrls.map((url) => ({ url, outcome: "ok" as const })) };
  });
  return sent;
}
async function settled(sent: unknown[], count: number) {
  await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(count));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(sent).toHaveLength(count);
}
function expectSource(source: EventSignalSource | null | undefined, scopeId: string, topic: EventSignalTopic, before: number) {
  expect(source).toMatchObject({ kind: 20078, topic: topicOf(scopeId, topic) });
  expect(source!.rev).toBeGreaterThanOrEqual(before);
}

describe("meet-token (user scope)", () => {
  it("the token carries the owner's source and display cap; a scan that uses it signals only the owner", async () => {
    const { staff, member } = await setup();
    const sent = spyPublish();
    const before = Date.now();
    const shown = await read<MeetToken>("GET", "/meet/token", member.cookie);
    expectSource(shown.signal, member.id, "meet-token", before);
    // The cap matches the server's "shown too long" rotation (90 s after issue)
    expect(shown.displayUntil).toBeGreaterThan(before);
    expect(shown.displayUntil).toBeLessThanOrEqual(Date.now() + 90_000);
    // Re-asking with the same token before the cap returns it unchanged (no signal)
    expect((await read<MeetToken>("GET", `/meet/token?current=${encodeURIComponent(shown.token)}`, member.cookie)).token).toBe(shown.token);
    expect(sent).toHaveLength(0);

    expect((await call("POST", "/meet/scan", staff.cookie, { token: shown.token })).status).toBe(200);
    await vi.waitFor(() => expect(sent.flat()).toContain(topicOf(member.id, "meet-token")));
    // Never the scanner's own topic
    expect(sent.flat()).not.toContain(topicOf(staff.id, "meet-token"));

    // A scan that writes nothing (token already used) sends nothing more for the owner
    const count = sent.flat().filter((t) => t === topicOf(member.id, "meet-token")).length;
    await call("POST", "/meet/scan", staff.cookie, { token: shown.token });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent.flat().filter((t) => t === topicOf(member.id, "meet-token"))).toHaveLength(count);
  });
});

describe("schedule-editing (staff lease)", () => {
  it("claim/release signal only when the holder changes; a save signals; the source is staff-only", async () => {
    const { staff, other, member, eventId } = await setup();
    const sent = spyPublish();
    const path = `/events/${eventId}/timetable/editing`;
    const topic = topicOf(eventId, "schedule-editing");
    const before = Date.now();

    const claimed = await read<ScheduleEditingState>("POST", path, staff.cookie);
    expect(claimed.editor?.userId).toBe(staff.id);
    expectSource(claimed.signal, eventId, "schedule-editing", before);
    // The lease is 30 minutes, not a 2-minute heartbeat window
    expect(claimed.editor!.expiresAt - claimed.editor!.startedAt).toBeGreaterThanOrEqual(SCHEDULE_EDIT_EXPIRE_MS - 1000);
    await settled(sent, 1);
    expect(sent[0]).toEqual([topic]);

    // Renewal by the same holder, and another staff failing to take over: no signal
    await read("POST", path, staff.cookie);
    expect((await read<ScheduleEditingState>("POST", path, other.cookie)).editor?.userId).toBe(staff.id);
    await read("DELETE", path, other.cookie);
    await settled(sent, 1);

    expectSource((await read<ScheduleEditingState>("GET", path, other.cookie)).signal, eventId, "schedule-editing", before);
    expect((await call("GET", path, member.cookie)).status).toBe(403);

    // Release by the holder: signal
    expect((await read<ScheduleEditingState>("DELETE", path, staff.cookie)).editor).toBeNull();
    await settled(sent, 2);

    // A save moves the version: signal
    const version = (await read<ScheduleEditingState>("GET", path, staff.cookie)).version;
    expect((await call("PUT", `/events/${eventId}/timetable`, staff.cookie, { version, items: [], tracks: [] })).status).toBe(200);
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(3));
    expect(sent.at(-1)).toContain(topic);
  });
});

describe("broadcasts (staff)", () => {
  it("the history carries the source; sending and the email drain signal the event", async () => {
    const { staff, member, eventId } = await setup();
    // The member can receive email (verified address + email on), so a send queues one
    await sql("INSERT INTO identity(id,user_id,provider,provider_user_id,email,created_at) VALUES(?,?,'google',?,?,1)", crypto.randomUUID(), member.id, crypto.randomUUID(), `${member.id.slice(0, 8)}@example.com`).run();
    await sql("INSERT INTO notification_pref(user_id,email_enabled,updated_at) VALUES(?,1,1)", member.id).run();
    const sent = spyPublish();
    const topic = topicOf(eventId, "broadcasts");
    const before = Date.now();

    expectSource((await read<EventBroadcastsPayload>("GET", `/events/${eventId}/broadcasts`, staff.cookie)).signal, eventId, "broadcasts", before);
    expect((await call("GET", `/events/${eventId}/broadcasts`, member.cookie)).status).toBe(403);

    expect((await call("POST", `/events/${eventId}/broadcasts`, staff.cookie, { segment: "confirmed", title: "t", body: "b" })).status).toBe(200);
    await vi.waitFor(() => expect(sent.flat()).toContain(topic));

    // The scheduled drain marks the queued email sent and signals that event once
    const after = sent.length;
    bindEnv({ ...(env as object), RESEND_API_KEY: "test-key" } as unknown as Env);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    await drainBroadcastEmails();
    const drained = sent.slice(after).flat().filter((t) => t === topic);
    expect(drained.length).toBeGreaterThanOrEqual(1);
  });
});
