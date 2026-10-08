import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_SIGNAL_KIND } from "@eventer/shared";
import type { ChatMembersPayload, EventLiveStateWithCutin, EventSignalConfig } from "@eventer/shared";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";
import { verifyEventSignature } from "../src/auth/nostr.js";

/**
 * Hide/unhide signal (D-POLL-MIN Phase 5a, docs/event-signal.md): the chat payloads
 * carry where to listen, and each committed hide/unhide/restore sends one
 * service-signed ephemeral event with the note's state read after the change.
 */

const BASE = "https://example.com";
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
afterEach(() => vi.restoreAllMocks());

async function makeUser(admin = false) {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)", id, admin ? "dev-user" : `nostr:${id}`, `u_${id.slice(0, 8)}`).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}

async function setup() {
  const staff = await makeUser(), viewer = await makeUser(), eventId = crypto.randomUUID(), now = Date.now();
  await sql(
    "INSERT INTO event(id,title,starts_at,ends_at,venue_type,status,visibility,chat_enabled,created_by,created_at) VALUES(?, 'Secret ceremony',?,?,'offline','published','public',1,?,?)",
    eventId, now - 3600_000, now + 3600_000, staff.id, now,
  ).run();
  for (const [user, role] of [[staff, "staff"], [viewer, "participant"]] as const) {
    await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,?,'confirmed',1)", crypto.randomUUID(), eventId, user.id, role).run();
  }
  return { staff, viewer, eventId };
}

function spyPublish() {
  return vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relayUrls): Promise<PublishReport> => ({
    ok: true,
    relays: relayUrls.map((url) => ({ url, outcome: "ok" as const })),
  }));
}

async function members(eventId: string, cookie: string): Promise<ChatMembersPayload> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/chat-members`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as ChatMembersPayload;
}

const hideNote = (eventId: string, noteId: string, cookie: string) =>
  SELF.fetch(`${BASE}/api/events/${eventId}/chat-hidden`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ noteId }),
  });
const unhideNote = (eventId: string, noteId: string, cookie: string) =>
  SELF.fetch(`${BASE}/api/events/${eventId}/chat-hidden/${noteId}`, { method: "DELETE", headers: { cookie } });
const moderate = (action: "hide" | "restore", eventId: string, id: string, cookie: string) =>
  SELF.fetch(`${BASE}/api/admin/moderation/events/${eventId}/${action}`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ kind: "chat_message", id }),
  });

function expectSignal(signal: Parameters<typeof nostrRelay.publishToRelays>[1], config: EventSignalConfig) {
  expect(signal.kind).toBe(EVENT_SIGNAL_KIND);
  expect(signal.pubkey).toBe(config.pubkey);
  expect(signal.tags).toEqual([["t", config.topic], ["-"]]);
  expect(verifyEventSignature(signal)).toBe(true);
  const content = JSON.parse(signal.content) as { rev: number; hidden: string[]; shown: string[] };
  expect(content.rev).toBeGreaterThan(config.rev - 1);
  expect(signal.created_at).toBe(Math.floor(content.rev / 1000));
  return content;
}

describe("chat-hidden signal (D-POLL-MIN Phase 5a)", () => {
  it("chat-members carries an opaque per-event topic, the same for every viewer", async () => {
    const { staff, viewer, eventId } = await setup();
    const other = await setup();
    const before = Date.now();
    const a = (await members(eventId, viewer.cookie)).hiddenSignal!;
    expect(a).toMatchObject({ kind: 20078, pubkey: expect.stringMatching(/^[0-9a-f]{64}$/), topic: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(a.rev).toBeGreaterThanOrEqual(before);
    expect(a.topic).not.toContain(eventId);
    expect((await members(eventId, staff.cookie)).hiddenSignal!.topic).toBe(a.topic);
    expect((await members(other.eventId, other.viewer.cookie)).hiddenSignal!.topic).not.toBe(a.topic);
  });

  it("staff hide and unhide each send one signal after commit; a no-op sends none", async () => {
    const { staff, viewer, eventId } = await setup();
    const config = (await members(eventId, viewer.cookie)).hiddenSignal!;
    const noteId = "d".repeat(64);
    const committed: boolean[] = [];
    const publish = spyPublish();
    publish.mockImplementation(async (relayUrls) => {
      committed.push(Boolean(await sql("SELECT 1 FROM event_chat_hidden WHERE event_id=? AND note_id=?", eventId, noteId).first()));
      return { ok: true, relays: relayUrls.map((url) => ({ url, outcome: "ok" as const })) };
    });

    expect((await hideNote(eventId, noteId, staff.cookie)).status).toBe(200);
    expect((await hideNote(eventId, noteId, staff.cookie)).status).toBe(200); // already hidden
    expect((await unhideNote(eventId, noteId, staff.cookie)).status).toBe(200);
    expect((await unhideNote(eventId, noteId, staff.cookie)).status).toBe(200); // already shown
    expect(publish).toHaveBeenCalledTimes(2);
    expect(committed).toEqual([true, false]);

    const [hide, show] = publish.mock.calls.map(([, signal]) => expectSignal(signal, config));
    expect(hide).toMatchObject({ hidden: [noteId], shown: [] });
    expect(show).toMatchObject({ hidden: [], shown: [noteId] });
    expect(show.rev).toBeGreaterThanOrEqual(hide.rev);
    for (const [, signal] of publish.mock.calls) {
      expect(JSON.stringify(signal)).not.toContain(eventId);
      expect(JSON.stringify(signal)).not.toContain("Secret ceremony");
    }
    // A payload read after the change reflects it and carries a newer rev.
    const after = await members(eventId, viewer.cookie);
    expect(after.hiddenNoteIds).toEqual([]);
    expect(after.hiddenSignal!.rev).toBeGreaterThanOrEqual(show.rev);
  });

  it("participants cannot cause a signal", async () => {
    const { viewer, eventId } = await setup();
    const publish = spyPublish();
    expect((await hideNote(eventId, "e".repeat(64), viewer.cookie)).status).toBe(403);
    expect(publish).not.toHaveBeenCalled();
  });

  it("admin restore sends the state read after the change: still hidden while a staff hide applies", async () => {
    const { staff, viewer, eventId } = await setup();
    const admin = await makeUser(true);
    const config = (await members(eventId, viewer.cookie)).hiddenSignal!;
    const noteId = "f".repeat(64);
    const publish = spyPublish();

    expect((await moderate("hide", eventId, noteId, admin.cookie)).status).toBe(200);
    expect(expectSignal(publish.mock.calls.at(-1)![1], config)).toMatchObject({ hidden: [noteId], shown: [] });
    // A staff unhide does not lift the admin hide: no state change, no signal.
    const calls = publish.mock.calls.length;
    expect((await unhideNote(eventId, noteId, staff.cookie)).status).toBe(200);
    expect(publish.mock.calls.length).toBe(calls);

    expect((await moderate("restore", eventId, noteId, admin.cookie)).status).toBe(200);
    expect(expectSignal(publish.mock.calls.at(-1)![1], config)).toMatchObject({ hidden: [], shown: [noteId] });
  });
});

describe("live-state chatSource follows the event's chat settings (D-POLL-MIN Phase 5a)", () => {
  it("returns off once the event can no longer show chat, without changing the stored choice", async () => {
    const { staff, eventId } = await setup();
    const path = `${BASE}/api/events/${eventId}/live-state`;
    const patch = await SELF.fetch(path, {
      method: "PATCH", headers: { cookie: staff.cookie, "content-type": "application/json" }, body: JSON.stringify({ chatSource: "event" }),
    });
    expect(patch.status).toBe(200);
    const read = async () => ((await (await SELF.fetch(path, { headers: { cookie: staff.cookie } })).json()) as EventLiveStateWithCutin).chatSource;
    expect(await read()).toBe("event");
    await sql("UPDATE event SET chat_enabled=0 WHERE id=?", eventId).run();
    expect(await read()).toBe("off");
    await sql("UPDATE event SET chat_enabled=1 WHERE id=?", eventId).run();
    expect(await read()).toBe("event");
    await sql("UPDATE event SET scheduling=1 WHERE id=?", eventId).run();
    expect(await read()).toBe("off");
  });
});
