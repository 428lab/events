import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import checkSql from "../../../scripts/check-member-counters.sql?raw";
import { bindEnv, type Env } from "../src/runtime.js";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";
import { eventMembersRepo } from "../src/db/repositories/eventMembers.js";
import {
  ATTENDED_COUNT_SQL,
  CAPACITY_TOTAL_SQL,
  PARTICIPANT_COUNT_SQL,
} from "../src/db/repositories/events.js";
import { SLOT_MEMBER_COUNT_SQL } from "../src/db/repositories/participationSlots.js";

/**
 * D-POLL-MIN Phase 4 (migration 0108): event / participation_slot keep stored member counts
 * (cnt_*) that triggers update on every write. Reads (findById, lists, my events, slots) now
 * use those columns instead of counting event_member.
 *
 * After each mutation path, scripts/check-member-counters.sql (the same COUNT queries as
 * PARTICIPANT_COUNT_SQL / ATTENDED_COUNT_SQL / CAPACITY_TOTAL_SQL / SLOT_MEMBER_COUNT_SQL) must
 * return no rows, and the API must report the same numbers the COUNT queries give.
 */

const BASE = "https://example.com/api";
const day = 86400000;
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args).run();

type Actor = { id: string; handle: string; cookie: string };

async function user(): Promise<Actor> {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), handle = `c_${id.slice(0, 8)}`;
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,?)", id, `t:${id}`, handle, Date.now());
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", sid, id, Date.now() + day);
  return { id, handle, cookie: `eventer_session=${sid}` };
}

async function request(path: string, actor: Actor | null, method = "GET", body?: unknown) {
  return SELF.fetch(BASE + path, {
    method,
    headers: { ...(actor ? { cookie: actor.cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response, status = 200): Promise<any> {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}

/** A published public event; the host is its staff member. */
async function setupEvent(host: Actor, opts: { attendanceCheck?: boolean } = {}): Promise<string> {
  const { event } = await json(await request("/events", host, "POST", {
    title: "counters", venueType: "offline", startsAt: Date.now() + day, endsAt: Date.now() + 2 * day,
  }), 201);
  await json(await request(`/events/${event.id}`, host, "PATCH", {
    status: "published", attendanceCheck: opts.attendanceCheck ?? false,
  }));
  return event.id as string;
}

async function addSlot(eventId: string, host: Actor, capacity: number, selectionType = "first_come") {
  return (await json(await request(`/events/${eventId}/slots`, host, "POST", {
    name: `slot ${capacity}`, capacity, selectionType,
  }), 201)).slot.id as string;
}

async function join(eventId: string, u: Actor, slotId: string | null = null) {
  return (await json(await request(`/events/${eventId}/join`, u, "POST", { slotId }), 201)).member;
}

/** A confirmed member without a slot in an event that has slots (staff-made / pre-slot rows).
 * The join route requires a slot there, so this writes the row directly; the triggers still run. */
async function addUnslotted(eventId: string, u: Actor, role = "participant") {
  await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,?,'confirmed',?)",
    crypto.randomUUID(), eventId, u.id, role, Date.now());
}

/** scripts/check-member-counters.sql, run as-is: ids of events/slots whose counters drifted. */
async function drift(): Promise<unknown[]> {
  const body = checkSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim().replace(/;$/, "");
  return (await env.DB.prepare(body).all()).results;
}

/** The COUNT oracle for one event, read independently of the stored columns. */
async function oracle(eventId: string) {
  return (await env.DB.prepare(`SELECT
      ${PARTICIPANT_COUNT_SQL("event.id")} AS participantCount,
      ${ATTENDED_COUNT_SQL("event.id")} AS attendedCount,
      ${CAPACITY_TOTAL_SQL("event.id")} AS capacityTotal
    FROM event WHERE id = ?`).bind(eventId).first<{ participantCount: number; attendedCount: number; capacityTotal: number | null }>())!;
}

async function slotOracle(slotId: string) {
  return (await env.DB.prepare(`SELECT
      ${SLOT_MEMBER_COUNT_SQL("s.id", "confirmed")} AS confirmedCount,
      ${SLOT_MEMBER_COUNT_SQL("s.id", "waitlist")} AS waitlistCount,
      ${SLOT_MEMBER_COUNT_SQL("s.id", "applied")} AS appliedCount
    FROM participation_slot s WHERE s.id = ?`).bind(slotId).first())!;
}

/** No drift anywhere, and the public detail / slots APIs report the oracle numbers. */
async function expectConsistent(eventId: string, viewer: Actor | null = null) {
  expect(await drift()).toEqual([]);
  const expected = await oracle(eventId);
  const { event } = await json(await request(`/events/${eventId}`, viewer));
  expect({
    participantCount: event.participantCount,
    attendedCount: event.attendedCount,
    capacityTotal: event.capacityTotal,
  }).toEqual(expected);
  const { slots } = await json(await request(`/events/${eventId}/slots`, viewer));
  for (const s of slots as Array<{ id: string; confirmedCount: number; waitlistCount: number; appliedCount: number }>) {
    expect({ confirmedCount: s.confirmedCount, waitlistCount: s.waitlistCount, appliedCount: s.appliedCount })
      .toEqual(await slotOracle(s.id));
  }
  return expected;
}

describe("0108 member counters stay equal to the COUNT queries", () => {
  it("join (confirmed / waitlist / lottery applied), leave, rejoin after cancel, waitlist promotion", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    expect((await expectConsistent(eventId)).participantCount).toBe(1); // the host (staff)
    const seat = await addSlot(eventId, host, 1);
    const lottery = await addSlot(eventId, host, 2, "lottery");
    expect((await expectConsistent(eventId)).capacityTotal).toBe(1 + 2 + 1);

    const [a, b, c] = [await user(), await user(), await user()];
    expect((await join(eventId, a, seat)).status).toBe("confirmed");
    expect((await join(eventId, b, seat)).status).toBe("waitlist");
    expect((await join(eventId, c, lottery)).status).toBe("applied");
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 2, capacityTotal: 4 });

    // a leaves → b is promoted from the waitlist inside the same batch
    await json(await request(`/events/${eventId}/join`, a, "DELETE"));
    expect((await eventMembersRepo.find(eventId, b.id))!.status).toBe("confirmed");
    expect((await expectConsistent(eventId)).participantCount).toBe(2);

    // b leaves (canceled row stays), then rejoins through the canceled-row upsert
    await json(await request(`/events/${eventId}/join`, b, "DELETE"));
    await expectConsistent(eventId);
    expect((await join(eventId, b, seat)).status).toBe("confirmed");
    expect((await expectConsistent(eventId)).participantCount).toBe(2);
  });

  it("lottery draw, manual slot status, attendance on/off, role change to staff and back", async () => {
    const host = await user();
    const eventId = await setupEvent(host, { attendanceCheck: true });
    const lottery = await addSlot(eventId, host, 1, "lottery");
    const [a, b, c] = [await user(), await user(), await user()];
    for (const u of [a, b, c]) await join(eventId, u, lottery);
    await expectConsistent(eventId);

    await json(await request(`/events/${eventId}/slots/${lottery}/draw`, host, "POST"));
    expect((await expectConsistent(eventId)).participantCount).toBe(2);

    const losers = (await env.DB.prepare("SELECT user_id FROM event_member WHERE slot_id=? AND status='lost'")
      .bind(lottery).all<{ user_id: string }>()).results;
    expect(losers).toHaveLength(2);
    await json(await request(`/events/${eventId}/slots/${lottery}/members/${losers[0].user_id}/status`, host, "PATCH", { status: "confirmed" }));
    expect((await expectConsistent(eventId)).participantCount).toBe(3);

    await json(await request(`/events/${eventId}/members/${losers[0].user_id}/attendance`, host, "PATCH", { attended: true }));
    expect((await expectConsistent(eventId)).attendedCount).toBe(1);
    // back to waitlist clears attendance (setStatus) → attended and participant both drop
    await json(await request(`/events/${eventId}/slots/${lottery}/members/${losers[0].user_id}/status`, host, "PATCH", { status: "waitlist" }));
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 2, attendedCount: 0 });

    // role → staff moves the member out of the slot (slot_id = NULL, confirmed): capacity_total grows by one
    await json(await request(`/events/${eventId}/members/${losers[0].user_id}/role`, host, "PATCH", { role: "staff" }));
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 3, capacityTotal: 1 + 2 });
    // back to participant = removed from the event (#281)
    await json(await request(`/events/${eventId}/members/${losers[0].user_id}/role`, host, "PATCH", { role: "participant" }));
    expect((await expectConsistent(eventId)).participantCount).toBe(2);
  });

  it("slot capacity edit, slot delete (members' slot_id set to NULL), event duplicate and delete", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const seat = await addSlot(eventId, host, 2);
    const other = await addSlot(eventId, host, 5);
    const [a, b] = [await user(), await user()];
    await join(eventId, a, seat);
    await join(eventId, b, other);
    expect((await expectConsistent(eventId)).capacityTotal).toBe(2 + 5 + 1);

    await json(await request(`/events/${eventId}/slots/${other}`, host, "PATCH", { capacity: 9 }));
    expect((await expectConsistent(eventId)).capacityTotal).toBe(2 + 9 + 1);

    await json(await request(`/events/${eventId}/slots/${other}`, host, "DELETE"));
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 3, capacityTotal: 2 + 2 });

    const { event: copy } = await json(await request(`/events/${eventId}/duplicate`, host, "POST", {}), 201);
    expect(await expectConsistent(copy.id, host)).toMatchObject({ participantCount: 1, capacityTotal: 2 + 1 });

    await json(await request(`/events/${eventId}`, host, "DELETE"));
    expect(await drift()).toEqual([]);
  });

  it("user soft delete, restore, purge, and hard delete of an active user", async () => {
    bindEnv(env as unknown as Env);
    const host = await user();
    const eventId = await setupEvent(host, { attendanceCheck: true });
    const seat = await addSlot(eventId, host, 5);
    const [a, b, c] = [await user(), await user(), await user()];
    await join(eventId, a, seat);
    await addUnslotted(eventId, b);
    await join(eventId, c, seat);
    await json(await request(`/events/${eventId}/members/${b.id}/attendance`, host, "PATCH", { attended: true }));
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 4, attendedCount: 1 });

    await accountDeletionRepo.requestDeletion(b.id, Date.now());
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 3, attendedCount: 0 });
    await accountDeletionRepo.restore(b.id);
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 4, attendedCount: 1 });

    // purge = hard delete of an already soft-deleted user
    await accountDeletionRepo.requestDeletion(b.id, Date.now());
    const ghost = await accountDeletionRepo.ensureDeletedUser();
    await accountDeletionRepo.deleteAccount(b.id, ghost.id);
    expect((await expectConsistent(eventId)).participantCount).toBe(3);

    // hard delete of an active user (BEFORE DELETE trigger runs ahead of the FK cascade)
    await accountDeletionRepo.deleteById(a.id);
    expect((await expectConsistent(eventId)).participantCount).toBe(2);
  });

  it("account merge: both in one event, loser staff, loser only in another event", async () => {
    bindEnv(env as unknown as Env);
    const host = await user();
    const shared = await setupEvent(host);
    const staffEvent = await setupEvent(host);
    const loserOnly = await setupEvent(host);
    const seat = await addSlot(shared, host, 3);
    const [winner, loser] = [await user(), await user()];
    await join(shared, winner, seat);
    await addUnslotted(shared, loser);
    await join(staffEvent, winner, null);
    await addUnslotted(staffEvent, loser, "staff");
    await join(loserOnly, loser, null);
    for (const id of [shared, staffEvent, loserOnly]) await expectConsistent(id);

    await accountMergeRepo.mergeUsers(winner.id, loser.id);
    expect((await expectConsistent(shared)).participantCount).toBe(2);
    expect((await expectConsistent(staffEvent)).participantCount).toBe(2);
    expect((await expectConsistent(loserOnly)).participantCount).toBe(2);
  });

  it("my events and the public profile list read the same counts as the detail", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const seat = await addSlot(eventId, host, 4);
    const a = await user();
    await join(eventId, a, seat);
    const expected = await expectConsistent(eventId);
    const mine = await json(await request("/me/events", a));
    const row = [...mine.ongoing, ...(mine.past ?? [])].find((e: { id: string }) => e.id === eventId);
    expect({ participantCount: row.participantCount, attendedCount: row.attendedCount, capacityTotal: row.capacityTotal })
      .toEqual(expected);
  });
});

describe("0108 migration", () => {
  type Migration = { name: string; queries: string[] };
  const migrations = (env as unknown as { TEST_MIGRATIONS: Migration[] }).TEST_MIGRATIONS;

  it("backfills counters for rows written before the triggers existed", async () => {
    const host = await user();
    const eventId = await setupEvent(host);
    const seat = await addSlot(eventId, host, 2);
    for (const status of ["confirmed", "confirmed", "waitlist", "applied"]) {
      const u = await user();
      await sql("INSERT INTO event_member(id,event_id,user_id,role,slot_id,status,created_at) VALUES(?,?,?,'participant',?,?,?)",
        crypto.randomUUID(), eventId, u.id, seat, status, Date.now());
    }
    // simulate the pre-0108 state: zero the counters, then rerun only the backfill UPDATEs
    await sql("UPDATE event SET cnt_participants=0,cnt_attended=0,cnt_unslotted_confirmed=0,cnt_slots=0,cnt_slot_capacity=0");
    await sql("UPDATE participation_slot SET cnt_confirmed=0,cnt_waitlist=0,cnt_applied=0");
    expect(await drift()).not.toEqual([]);
    const m0108 = migrations.find((m) => m.name.startsWith("0108_"))!;
    for (const q of m0108.queries.filter((q) => /^\s*UPDATE /.test(q))) await env.DB.prepare(q).run();
    expect(await expectConsistent(eventId)).toMatchObject({ participantCount: 3, capacityTotal: 2 + 1 });
  });

  /** REPLACE deletes the old row without firing DELETE triggers (recursive_triggers is off),
   * so the counters would drift. Writers must use INSERT ... ON CONFLICT DO UPDATE instead. */
  it("no source writes REPLACE on the counted tables", () => {
    const sources = import.meta.glob("../src/**/*.ts", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([, src]) => /(INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\s+(event_member|participation_slot|user)\b/i.test(src))
      .map(([file]) => file);
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
