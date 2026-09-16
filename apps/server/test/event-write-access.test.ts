import { SELF, env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { promoteFromWaitlist } from "../src/lib/waitlist.js";
import { eventsRepo } from "../src/db/repositories/events.js";
import { communitiesRepo } from "../src/db/repositories/communities.js";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";
import { bindEnv, runWithExecutionContext } from "../src/runtime.js";
import { schedulingRepo } from "../src/db/repositories/scheduling.js";
import { eventSurveyRepo } from "../src/db/repositories/eventSurvey.js";
import { scheduleRegistrationRepo } from "../src/db/repositories/scheduleRegistration.js";
import { eventMembersRepo } from "../src/db/repositories/eventMembers.js";
import { sendNotificationEmailToWithOutcome } from "../src/lib/email.js";
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

it("late vote and participation-answer writes cannot follow a viewing revocation", async () => {
  const s = await setup(), target = await user(); await grant(s, target);
  const { questions } = await json(await request(`/events/${s.eventId}/survey`, s.host, "PUT", {
    questions: [{ question: "Answer", qtype: "text", required: false, options: [] }],
  }));
  expect(await schedulingRepo.vote(s.eventId, s.optionId, target.id, "yes")).toBe(true);
  expect(await eventSurveyRepo.upsertAnswers(s.eventId, target.id, [{ questionId: questions[0].id, value: "before" }])).toBe(true);
  await exit(s.eventId, target);
  expect(await schedulingRepo.vote(s.eventId, s.optionId, target.id, "no")).toBe(false);
  expect(await eventSurveyRepo.upsertAnswers(s.eventId, target.id, [{ questionId: questions[0].id, value: "late" }])).toBe(false);
  expect(await count("event_survey_answer", s.eventId)).toBe(0);
  expect((await schedulingRepo.myVotes(s.eventId, target.id))[s.optionId]).toBe("yes"); // history retained
});

it("finalization skips revoked voters, retains ordering and creates only qualified entries/notifications", async () => {
  const s = await setup(), revoked = await user(), a = await user(), b = await user();
  for (const u of [revoked, a, b]) { await grant(s, u); expect(await schedulingRepo.vote(s.eventId, s.optionId, u.id, "yes")).toBe(true); }
  await sql("UPDATE event_date_vote SET created_at=20 WHERE option_id=?", s.optionId);
  await sql("UPDATE event_date_vote SET created_at=10 WHERE option_id=? AND user_id=?", s.optionId, revoked.id);
  await json(await request(`/events/${s.eventId}/slots`, s.host, "POST", { name: "One seat", capacity: 1, selectionType: "first_come" }), 201);
  await exit(s.eventId, revoked);
  const before = (await json(await request(`/events/${s.eventId}/access-invites`, s.host))).accessRevision;
  const result = await json(await request(`/events/${s.eventId}/finalize-date`, s.host, "POST", { optionId: s.optionId }));
  expect(result.results.find((r: any) => r.userId === revoked.id)).toMatchObject({ outcome: "action_required", reason: "access_revoked", status: null });
  const eligible = [a.id, b.id].sort();
  expect(result.results.find((r: any) => r.userId === eligible[0]).status).toBe("confirmed");
  expect(result.results.find((r: any) => r.userId === eligible[1]).status).toBe("waitlist");
  expect(result.event.accessRevision).toBe(before + 1);
  expect(await count("entry", s.eventId)).toBe(1);
  const notices = await env.DB.prepare("SELECT user_id,body,event_id FROM notification WHERE event_id=? AND type='schedule_finalized'").bind(s.eventId).all();
  expect(notices.results).toHaveLength(2);
  expect(notices.results.some(n => n.user_id === revoked.id)).toBe(false);
  expect(JSON.stringify(notices.results)).not.toContain("SECRET");
  expect(await schedulingRepo.vote(s.eventId, s.optionId, a.id, "no")).toBe(false); // finalized in SQL
  const replay = await json(await request(`/events/${s.eventId}/finalize-date`, s.host, "POST", { optionId: s.optionId }));
  expect(replay.results).toEqual(result.results);
  expect(await count("entry", s.eventId)).toBe(1);
});

it("a demoted finalizer cannot claim a receipt or change date/member/revision after the route check", async () => {
  const s = await setup(), target = await user(); await grant(s, target);
  expect(await schedulingRepo.vote(s.eventId, s.optionId, target.id, "yes")).toBe(true);
  await eventMembersRepo.remove(s.eventId, s.host.id);
  const before = await env.DB.prepare("SELECT access_revision,scheduling FROM event WHERE id=?").bind(s.eventId).first();
  expect(await scheduleRegistrationRepo.finalize(s.eventId, s.optionId, s.host.id, "SECRET")).toBe(false);
  expect(await count("event_schedule_finalization", s.eventId)).toBe(0);
  expect(await count("entry", s.eventId)).toBe(0);
  expect(await env.DB.prepare("SELECT access_revision,scheduling FROM event WHERE id=?").bind(s.eventId).first()).toEqual(before);
});

it("active-account checks still apply to publicly viewable vote and answer writes", async () => {
  const s = await setup(), target = await user();
  await sql("UPDATE event SET visibility='public' WHERE id=?", s.eventId);
  const { questions } = await json(await request(`/events/${s.eventId}/survey`, s.host, "PUT", {
    questions: [{ question: "Answer", qtype: "text", required: false, options: [] }],
  }));
  await sql("UPDATE user SET deleted_at=? WHERE id=?", Date.now(), target.id);
  expect(await schedulingRepo.vote(s.eventId, s.optionId, target.id, "yes")).toBe(false);
  expect(await eventSurveyRepo.upsertAnswers(s.eventId, target.id, [{ questionId: questions[0].id, value: "late" }])).toBe(false);
});

it("schedule email rechecks access at delivery and strips nonpublic body/cards", async () => {
  const s = await setup(), target = await user(); await grant(s, target);
  bindEnv({ ...env, RESEND_API_KEY: "fixture-key" } as never);
  const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{}', { status: 200 }));
  await sql("INSERT INTO identity(id,user_id,provider,provider_user_id,email,created_at) VALUES(?,?,'google',?,'fixture@example.com',1)",crypto.randomUUID(),target.id,target.id);
  await sql("INSERT INTO notification_pref(user_id,email_enabled,updated_at) VALUES(?,1,1)",target.id);
  const extras = { authorizationEventId: s.eventId };
  expect((await sendNotificationEmailToWithOutcome(target.id, "fixture@example.com", "SECRET title", "SECRET body", `/events/${s.eventId}`, extras)).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(String(send.mock.calls[0][1]?.body)).not.toContain("SECRET");
  // Revoke through the real API, then simulate the queued sender's late turn.
  send.mockRestore(); await exit(s.eventId, target);
  bindEnv({ ...env, RESEND_API_KEY: "fixture-key" } as never);
  const late = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{}', { status: 200 }));
  expect(await sendNotificationEmailToWithOutcome(target.id, "fixture@example.com", "SECRET title", "SECRET body", `/events/${s.eventId}`, extras)).toEqual({ ok: false, retryable: false, skipped: true });
  expect(late).not.toHaveBeenCalled();
});


it("ordinary concurrent promotions skip lost access and commit one membership/Entry/notice/revision", async () => {
  const s = await setup(), revoked = await user(), eligible = await user();
  for (const u of [revoked, eligible]) await grant(s, u);
  const { slot } = await json(await request(`/events/${s.eventId}/slots`, s.host, "POST", { name: "One seat", capacity: 1, selectionType: "first_come" }), 201);
  // Retained stale waitlist history; grants above were obtained through HTTP.
  for (const [u, time] of [[revoked, 1], [eligible, 2]] as const) await sql(
    "INSERT INTO event_member(id,event_id,user_id,role,status,slot_id,created_at) VALUES(?,?,?,'participant','waitlist',?,?)",
    crypto.randomUUID(), s.eventId, u.id, slot.id, time);
  await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=? AND user_id=?", s.eventId, revoked.id);
  const event = (await eventsRepo.findById(s.eventId))!;
  const results = await Promise.all([promoteFromWaitlist(event, slot.id), promoteFromWaitlist(event, slot.id)]);
  expect(results.filter(Boolean)).toEqual([eligible.id]);
  expect(await count("entry", s.eventId)).toBe(1);
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(event.accessRevision + 1);
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM notification WHERE event_id=? AND type='waitlist_promoted'").bind(s.eventId).first())!.n).toBe(1);
  expect((await eventMembersRepo.find(s.eventId, revoked.id))!.status).toBe("waitlist");
});

it("ordinary promotion rolls back the membership/revision/notice when Entry creation fails", async () => {
  const s = await setup(), target = await user(); await grant(s, target);
  const { slot } = await json(await request(`/events/${s.eventId}/slots`, s.host, "POST", { name: "One seat", capacity: 1, selectionType: "first_come" }), 201);
  await sql("INSERT INTO event_member(id,event_id,user_id,role,status,slot_id,created_at) VALUES(?,?,?,'participant','waitlist',?,1)", crypto.randomUUID(), s.eventId, target.id, slot.id);
  const event = (await eventsRepo.findById(s.eventId))!, notices = await count("notification", s.eventId);
  await env.DB.exec("CREATE TRIGGER fail_promotion BEFORE INSERT ON entry BEGIN SELECT RAISE(ABORT, 'promotion failure'); END");
  try { await expect(promoteFromWaitlist(event, slot.id)).rejects.toThrow(); }
  finally { await env.DB.exec("DROP TRIGGER fail_promotion"); }
  expect((await eventMembersRepo.find(s.eventId, target.id))!.status).toBe("waitlist");
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(event.accessRevision);
  expect(await count("notification", s.eventId)).toBe(notices);
  expect(await count("entry", s.eventId)).toBe(0);
});

it("community qualification changes revise only linked events and a demoted manager cannot finalize", async () => {
  const s = await setup(), unrelated = await setup(), target = await user();
  const community = await communitiesRepo.create({ slug: `c-${s.eventId}`, name: "Community" }, s.host.id);
  const before = (await eventsRepo.findById(s.eventId))!.accessRevision;
  await eventsRepo.update(s.eventId, { communityId: community.id }, s.host.id);
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(before + 1);
  const otherRev = (await eventsRepo.findById(unrelated.eventId))!.accessRevision;
  await communitiesRepo.setMemberRole(community.id, target.id, "admin");
  const adminRev = (await eventsRepo.findById(s.eventId))!.accessRevision;
  await communitiesRepo.setMemberRole(community.id, target.id, "member");
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(adminRev + 1);
  expect(await scheduleRegistrationRepo.finalize(s.eventId, s.optionId, target.id, "private")).toBe(false);
  await communitiesRepo.leave(community.id, target.id);
  await communitiesRepo.delete(community.id);
  expect((await eventsRepo.findById(s.eventId))!.communityId).toBeNull();
  expect((await eventsRepo.findById(unrelated.eventId))!.accessRevision).toBe(otherRev);
});

it("account deletion, restoration, merge and final deletion invalidate only related event revisions", async () => {
  const s = await setup(), unrelated = await setup(), target = await user(), winner = await user();
  await grant(s, target);
  const initial = (await eventsRepo.findById(s.eventId))!.accessRevision;
  const other = (await eventsRepo.findById(unrelated.eventId))!.accessRevision;
  await accountDeletionRepo.requestDeletion(target.id, Date.now());
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(initial + 1);
  await accountDeletionRepo.restore(target.id);
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(initial + 2);
  await accountMergeRepo.mergeUsers(winner.id, target.id);
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(initial + 3);
  await accountDeletionRepo.deleteById(winner.id);
  expect((await eventsRepo.findById(s.eventId))!.accessRevision).toBe(initial + 4);
  expect((await eventsRepo.findById(unrelated.eventId))!.accessRevision).toBe(other);
});


it("promotion returns committed results while a stalled email remains in waitUntil", async () => {
  const s = await setup(), target = await user(); await grant(s, target);
  const { slot } = await json(await request(`/events/${s.eventId}/slots`, s.host, "POST", { name: "Seat", capacity: 1, selectionType: "first_come" }), 201);
  await sql("INSERT INTO event_member(id,event_id,user_id,role,status,slot_id,created_at) VALUES(?,?,?,'participant','waitlist',?,1)", crypto.randomUUID(), s.eventId, target.id, slot.id);
  await sql("INSERT INTO identity(id,user_id,provider,provider_user_id,email,created_at) VALUES(?,?,'google',?,'fixture@example.com',1)", crypto.randomUUID(), target.id, crypto.randomUUID());
  await sql("INSERT INTO notification_pref(user_id,email_enabled,updated_at) VALUES(?,1,1)", target.id);
  bindEnv({ ...env, RESEND_API_KEY: "fixture" } as never);
  let release!: (r: Response) => void;
  const held = new Promise<Response>(resolve => { release = resolve; });
  const outbound = vi.spyOn(globalThis, "fetch").mockReturnValue(held);
  const pending: Promise<unknown>[] = [];
  const context = { waitUntil: (p: Promise<unknown>) => pending.push(p) };
  let returned = false;
  const event = (await eventsRepo.findById(s.eventId))!;
  const operation = runWithExecutionContext(context as never, () => promoteFromWaitlist(event, slot.id));
  void operation.then(() => { returned = true; });
  try {
    await vi.waitFor(() => expect(outbound).toHaveBeenCalledTimes(1));
    expect(returned).toBe(true);
    expect(pending).toHaveLength(1);
    expect(await operation).toBe(target.id);
    expect((await eventMembersRepo.find(s.eventId, target.id))!.status).toBe("confirmed");
    expect(await count("entry", s.eventId)).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM notification WHERE event_id=? AND type='waitlist_promoted'").bind(s.eventId).first())!.n).toBe(1);
  } finally { release(new Response('{}')); await Promise.all([...pending, operation]); outbound.mockRestore(); }
});
