import { SELF, env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { bindEnv } from "../src/runtime.js";
import { drawMemberSlots, setMemberSlotStatus } from "../src/db/repositories/memberSlotResults.js";
import { changeMembership } from "../src/db/repositories/membershipChange.js";
import { eventMembersRepo } from "../src/db/repositories/eventMembers.js";
import { eventsRepo } from "../src/db/repositories/events.js";
import { eventStaffInvitesRepo } from "../src/db/repositories/eventStaffInvites.js";
import { entriesRepo } from "../src/db/repositories/entries.js";
import { schedulingRepo } from "../src/db/repositories/scheduling.js";
import { eventSurveyRepo } from "../src/db/repositories/eventSurvey.js";

const day = 86400000, base = "https://example.com/api";
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args).run();
async function user() {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), handle = `u_${id.slice(0, 8)}`;
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,?)", id, id, handle, Date.now());
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", sid, id, Date.now() + day);
  return { id, handle, cookie: `eventer_session=${sid}` };
}
type Actor = Awaited<ReturnType<typeof user>>;
async function request(path: string, actor: Actor, method = "GET", body?: unknown) {
  return SELF.fetch(base + path, { method, headers: { cookie: actor.cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function json(response: Response, status = 200): Promise<any> {
  expect(response.status, await response.clone().text()).toBe(status); return response.json();
}
async function setup() {
  const host = await user();
  const { event } = await json(await request("/events", host, "POST", { title: "SECRET private poll", scheduling: true,
    startsAt: Date.now() + day, endsAt: Date.now() + 2 * day, venueType: "online" }), 201);
  await sql("UPDATE event SET status='published',visibility='private' WHERE id=?", event.id);
  const { id: optionId } = await json(await request(`/events/${event.id}/date-options`, host, "POST", { startsAt: Date.now() + day, endsAt: Date.now() + 2 * day }), 201);
  bindEnv(env as never);
  return { host, eventId: event.id as string, optionId: optionId as string };
}
async function grant(s: Awaited<ReturnType<typeof setup>>, recipient: Actor) {
  const { accessRevision } = await json(await request(`/events/${s.eventId}/access-invites`, s.host));
  const { invite } = await json(await request(`/events/${s.eventId}/access-invites`, s.host, "POST", {
    handle: recipient.handle, expectedUserId: recipient.id, expectedAccessRevision: accessRevision,
  }), 201);
  await json(await request(`/me/event-invites/${invite.id}/accept`, recipient, "POST", {}));
}
async function exit(eventId: string, recipient: Actor) {
  await json(await request(`/events/${eventId}/access`, recipient, "DELETE", { confirmCancelParticipation: true }));
}
const count = async (table: string, eventId: string) => (await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE event_id=?`).bind(eventId).first<{ n: number }>())!.n;
afterEach(() => vi.restoreAllMocks());


async function slot(s: Awaited<ReturnType<typeof setup>>, kind = "lottery", capacity = 1) {
  return (await json(await request(`/events/${s.eventId}/slots`, s.host, "POST", { name: "Seat", capacity, selectionType: kind }), 201)).slot.id as string;
}
async function join(s: Awaited<ReturnType<typeof setup>>, u: Actor, slotId: string) {
  await grant(s, u);
  return (await json(await request(`/events/${s.eventId}/join`, u, "POST", { slotId }), 201)).member;
}
async function revokedHistory(s: Awaited<ReturnType<typeof setup>>, u: Actor) {
  await sql("UPDATE event SET scheduling=0,ends_at=? WHERE id=?", Date.now()-1, s.eventId);
  await exit(s.eventId, u);
}

it("lottery filters revoked targets at write time, preserves supplied order and subtracts held seats", async () => {
  const s = await setup(), id = await slot(s, "lottery", 2);
  const held = await user(), revoked = await user(), first = await user(), last = await user();
  await join(s, held, id); const r = await join(s, revoked, id), f = await join(s, first, id), l = await join(s, last, id);
  expect(await setMemberSlotStatus(s.eventId, s.host.id, id, held.id, "confirmed")).toBe(true);
  await revokedHistory(s, revoked);
  expect(await drawMemberSlots(s.eventId, s.host.id, id, [r.id, f.id, l.id])).toEqual({ drawn: 2, confirmed: 1, lost: 1 });
  expect((await eventMembersRepo.find(s.eventId, revoked.id))!.status).toBe("applied");
  expect((await eventMembersRepo.find(s.eventId, first.id))!.status).toBe("confirmed");
  expect((await eventMembersRepo.find(s.eventId, last.id))!.status).toBe("lost");
  expect(await count("entry", s.eventId)).toBe(2);
  expect(await setMemberSlotStatus(s.eventId, s.host.id, id, revoked.id, "confirmed")).toBe(false);
  expect(await changeMembership(s.eventId, s.host.id, revoked.id, await eventMembersRepo.find(s.eventId, revoked.id), "staff")).toBeNull();
});

it("a late demoted actor cannot draw, confirm or change role, with no result/Entry/revision writes", async () => {
  const s = await setup(), id = await slot(s), target = await user();
  const member = await join(s, target, id);
  await eventMembersRepo.remove(s.eventId, s.host.id);
  const before = (await eventsRepo.findById(s.eventId))!.accessRevision, notices = await count("notification", s.eventId);
  expect(await drawMemberSlots(s.eventId, s.host.id, id, [member.id])).toBeNull();
  expect(await setMemberSlotStatus(s.eventId, s.host.id, id, target.id, "confirmed")).toBe(false);
  expect(await changeMembership(s.eventId, s.host.id, target.id, await eventMembersRepo.find(s.eventId, target.id), "staff")).toBeNull();
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(before);
  expect(await count("entry", s.eventId)).toBe(0);
  expect(await count("notification", s.eventId)).toBe(notices);
});

it.each(["draw", "manual"])("%s Entry failure rolls back result, notification and revision", async mode => {
  const s = await setup(), id = await slot(s), target = await user(), m = await join(s, target, id);
  const before = (await eventsRepo.findById(s.eventId))!.accessRevision, notices = await count("notification", s.eventId);
  await env.DB.exec("CREATE TRIGGER fail_result BEFORE INSERT ON entry BEGIN SELECT RAISE(ABORT,'result failure'); END");
  try {
    await expect(mode === "draw" ? drawMemberSlots(s.eventId, s.host.id, id, [m.id]) : setMemberSlotStatus(s.eventId, s.host.id, id, target.id, "confirmed")).rejects.toThrow();
  } finally { await env.DB.exec("DROP TRIGGER fail_result"); }
  expect((await eventMembersRepo.find(s.eventId, target.id))!.status).toBe("applied");
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(before);
  expect(await count("entry", s.eventId)).toBe(0);
  expect(await count("notification", s.eventId)).toBe(notices);
});

it("ordinary leave rolls back cancellation, answers, old Entry and promoted Entry together", async () => {
  const s = await setup(), id = await slot(s, "first_come"), leaving = await user(), waiting = await user();
  await join(s, leaving, id); await join(s, waiting, id);
  const { questions } = await json(await request(`/events/${s.eventId}/survey`, s.host, "PUT", { questions: [{ question: "Answer", qtype: "text", required: false, options: [] }] }));
  await json(await request(`/events/${s.eventId}/survey/my`, leaving, "PUT", { answers: [{ questionId: questions[0].id, value: "keep on rollback" }] }));
  const before = (await eventsRepo.findById(s.eventId))!.accessRevision;
  await env.DB.exec("CREATE TRIGGER fail_replacement BEFORE INSERT ON entry BEGIN SELECT RAISE(ABORT,'replacement failure'); END");
  try { await expect(changeMembership(s.eventId, leaving.id, leaving.id, await eventMembersRepo.find(s.eventId, leaving.id))).rejects.toThrow(); }
  finally { await env.DB.exec("DROP TRIGGER fail_replacement"); }
  expect((await eventMembersRepo.find(s.eventId, leaving.id))!.status).toBe("confirmed");
  expect((await eventMembersRepo.find(s.eventId, waiting.id))!.status).toBe("waitlist");
  expect(await count("entry", s.eventId)).toBe(1);
  expect(await count("event_survey_answer", s.eventId)).toBe(1);
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(before);
  expect(await json(await request(`/events/${s.eventId}/join`, leaving, "DELETE"))).toMatchObject({ promotedUserId: waiting.id });
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(before+1);
  expect(await count("event_survey_answer", s.eventId)).toBe(0);
  expect((await request(`/events/${s.eventId}`, leaving)).status).toBe(200); // viewing grant is retained
});

it("staff invitation cannot accept after inviter demotion and includes promotion in the acceptance batch", async () => {
  const s = await setup(), id = await slot(s, "first_come"), target = await user(), waiting = await user();
  await join(s, target, id); await join(s, waiting, id);
  await json(await request(`/events/${s.eventId}/staff-invites`, s.host, "POST", { handle: target.handle }), 201);
  const pending = (await eventStaffInvitesRepo.find(s.eventId, target.id))!;
  const before = (await eventsRepo.findById(s.eventId))!.accessRevision;
  await env.DB.exec("CREATE TRIGGER fail_accept_promotion BEFORE INSERT ON entry BEGIN SELECT RAISE(ABORT,'staff promotion failure'); END");
  try { await expect(eventStaffInvitesRepo.accept(pending.id, s.eventId, target.id)).rejects.toThrow(); }
  finally { await env.DB.exec("DROP TRIGGER fail_accept_promotion"); }
  expect((await eventStaffInvitesRepo.findById(pending.id))!.status).toBe("pending");
  expect((await eventMembersRepo.find(s.eventId, target.id))!.role).toBe("participant");
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(before);
  await eventMembersRepo.remove(s.eventId, s.host.id);
  expect(await eventStaffInvitesRepo.accept(pending.id, s.eventId, target.id)).toBeNull();
  expect((await eventMembersRepo.find(s.eventId, waiting.id))!.status).toBe("waitlist");
});

it("revoked owner cannot update an Entry submission retained after event end", async () => {
  const s = await setup(), id = await slot(s, "first_come"), target = await user(); await join(s, target, id);
  const entry = (await entriesRepo.findIndividualEntry(s.eventId, target.id))!;
  expect(await entriesRepo.upsertSubmission(s.eventId, entry.id, target.id, "https://before.example", null)).toBeTruthy();
  await revokedHistory(s, target);
  expect(await entriesRepo.upsertSubmission(s.eventId, entry.id, target.id, "https://late.example", null)).toBeNull();
  expect((await entriesRepo.findById(entry.id))!.submission!.presentationUrl).toBe("https://before.example");
});

it("late demotion blocks candidate/question definitions and general event edits/deletion", async () => {
  const s = await setup(); await eventMembersRepo.remove(s.eventId, s.host.id);
  const before = (await eventsRepo.findById(s.eventId))!;
  expect(await schedulingRepo.addOption(s.eventId, Date.now()+day, Date.now()+2*day, s.host.id)).toBeNull();
  expect(await schedulingRepo.deleteOption(s.eventId, s.optionId, s.host.id)).toBe(false);
  expect(await eventSurveyRepo.replaceQuestions(s.eventId, "pre", [{ question: "unauthorized", qtype: "text", required: false, options: [] }], s.host.id)).toBeNull();
  expect(await eventsRepo.update(s.eventId, { title: "unauthorized" }, s.host.id)).toBeNull();
  expect(await eventsRepo.setStatus(s.eventId, "archived", s.host.id)).toBeNull();
  expect(await eventsRepo.delete(s.eventId, s.host.id)).toBe(false);
  expect((await eventsRepo.findById(s.eventId))!.title).toBe(before.title);
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(before.accessRevision);
  expect(await count("event_date_option", s.eventId)).toBe(1);
  expect(await count("event_survey_question", s.eventId)).toBe(0);
});
