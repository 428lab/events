import { SELF, env } from "cloudflare:test";
import { joinPrivateEvent } from "../src/db/repositories/privateEventJoin.js";
import { bindEnv, type Env } from "../src/runtime.js";
import { app } from "../src/worker.js";
import { eventAccessInvitesRepo } from "../src/db/repositories/eventAccessInvites.js";
import * as exits from "../src/db/repositories/eventAccessExit.js";
import { describe, expect, it, vi } from "vitest";

const base = "https://example.com";
const DAY = 86_400_000;
async function user() {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), handle = `u_${id.slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, ?)").bind(id, `fixture:${id}`, handle, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, id, Date.now() + DAY).run();
  return { id, handle, cookie: `eventer_session=${sid}` };
}
type Actor = Awaited<ReturnType<typeof user>>;
async function req(path: string, actor?: Actor, method = "GET", body?: unknown) {
  return SELF.fetch(`${base}/api${path}`, { method,
    headers: { ...(actor ? { cookie: actor.cookie } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(res: Response, status = 200): Promise<any> {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json();
}
async function setup(status = "published") {
  const host = await user(), target = await user();
  const { event } = await json(await req("/events", host, "POST", {
    title: "Private lifecycle fixture", venueType: "online", startsAt: Date.now() + DAY, endsAt: Date.now() + 2 * DAY,
  }), 201);
  // Only visibility/status is seeded locally; every grant below comes from real invitation HTTP.
  await env.DB.prepare("UPDATE event SET visibility = 'private', status = ? WHERE id = ?").bind(status, event.id).run();
  return { host, target, eventId: event.id as string };
}
async function revision(eventId: string, host: Actor) {
  return (await json(await req(`/events/${eventId}/access-invites`, host))).accessRevision as number;
}
async function invite(eventId: string, host: Actor, target: Actor) {
  const body = await json(await req(`/events/${eventId}/access-invites`, host, "POST", {
    handle: `@${target.handle}`, expectedUserId: target.id, expectedAccessRevision: await revision(eventId, host),
  }), 201);
  return body.invite.id as string;
}
async function accept(id: string, target: Actor) {
  return json(await req(`/me/event-invites/${id}/accept`, target, "POST", {}));
}
async function leave(eventId: string, target: Actor) {
  return req(`/events/${eventId}/access`, target, "DELETE", { confirmCancelParticipation: true });
}
async function count(table: string, eventId: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE event_id = ?`).bind(eventId).first<{ n: number }>())!.n;
}

describe("identity-bound viewing invitations over HTTP", () => {
  it("delivers only minimal pending data, accepts idempotently, and does not register or reserve a seat", async () => {
    const { host, target, eventId } = await setup();
    const stranger = await user(), id = await invite(eventId, host, target);
    const pending = await json(await req("/me/event-invites", target));
    expect(Object.keys(pending.invites[0]).sort()).toEqual(["expiresAt", "id", "inviterName", "status", "title"]);
    expect(pending.invites[0].expiresAt - Date.now()).toBeGreaterThan(6.9 * DAY);
    expect(pending.invites[0].expiresAt - Date.now()).toBeLessThanOrEqual(7 * DAY);
    expect((await req(`/events/${eventId}`, target)).status).toBe(404);
    for (const action of ["", "/accept", "/decline"]) {
      expect((await req(`/me/event-invites/${id}${action}`, stranger, action ? "POST" : "GET", action ? {} : undefined)).status).toBe(404);
    }
    const before = await revision(eventId, host);
    const responses = await Promise.all([accept(id, target), accept(id, target)]);
    expect(responses.every((r) => r.eventId === eventId && r.canOpenEvent)).toBe(true);
    expect(await revision(eventId, host)).toBe(before + 1);
    expect(await count("event_member", eventId)).toBe(1); // host only
    expect(await count("entry", eventId)).toBe(0);
    expect((await req(`/events/${eventId}`, target)).status).toBe(200);
    expect((await req(`/events/${eventId}/photos`, target)).status).toBe(403);
    expect((await req(`/events/${eventId}/staff-chat`, target)).status).toBe(403);
    const notification = await env.DB.prepare("SELECT type,title,body,link,event_id FROM notification WHERE user_id = ?").bind(target.id).all();
    expect(notification.results).toHaveLength(1);
    expect(notification.results[0]).toMatchObject({ type: "event_access_invite", body: "", link: "/event-invites", event_id: eventId });
    expect(JSON.stringify(notification.results)).not.toContain("Private lifecycle");
  });

  it("detects handle reassignment without writes, and changing only expectedUserId cannot target another account", async () => {
    const { host, target, eventId } = await setup(), other = await user();
    const rev = await revision(eventId, host);
    await env.DB.prepare("UPDATE user SET username = ? WHERE id = ?").bind(`old_${target.handle}`, target.id).run();
    await env.DB.prepare("UPDATE user SET username = ? WHERE id = ?").bind(target.handle, other.id).run();
    for (const expectedUserId of [target.id, host.id]) {
      expect(await json(await req(`/events/${eventId}/access-invites`, host, "POST", {
        handle: target.handle, expectedUserId, expectedAccessRevision: rev,
      }), 409)).toEqual({ error: "handle_changed" });
    }
    expect(await count("event_access_invite", eventId)).toBe(0);
    expect(await count("notification", eventId)).toBe(0);
    expect(await revision(eventId, host)).toBe(rev);
    const id = await invite(eventId, host, { ...other, handle: target.handle });
    await env.DB.prepare("UPDATE user SET username = ? WHERE id = ?").bind("renamed_after_invitation", other.id).run();
    expect((await accept(id, other)).canOpenEvent).toBe(true);
    expect((await req(`/me/event-invites/${id}`, target)).status).toBe(404);
  });

  it("reissue replaces the ID, decline is idempotent, expiry and inviter demotion do not grant access", async () => {
    const { host, target, eventId } = await setup();
    const old = await invite(eventId, host, target);
    const { invite: fresh } = await json(await req(`/events/${eventId}/access-invites/${old}/reissue`, host, "POST", { expectedAccessRevision: await revision(eventId, host) }));
    expect(fresh.id).not.toBe(old);
    expect((await req(`/me/event-invites/${old}/accept`, target, "POST", {})).status).toBe(404);
    for (let n = 0; n < 2; n++) await json(await req(`/me/event-invites/${fresh.id}/decline`, target, "POST", {}));
    expect((await req(`/me/event-invites/${fresh.id}/accept`, target, "POST", {})).status).toBe(409);
    const id = await invite(eventId, host, target);
    await env.DB.prepare("UPDATE event_access_invite SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, id).run();
    expect(await json(await req(`/me/event-invites/${id}/accept`, target, "POST", {}), 409)).toEqual({ error: "invite_expired" });
    const next = await invite(eventId, host, target);
    await env.DB.prepare("DELETE FROM event_member WHERE event_id = ? AND user_id = ?").bind(eventId, host.id).run();
    expect(await json(await req(`/me/event-invites/${next}/accept`, target, "POST", {}), 409)).toEqual({ error: "inviter_not_staff" });
    expect((await req(`/events/${eventId}`, target)).status).toBe(404);
  });

  it.each(["draft", "archived"])("accepted-only %s retains a body-free list and ownership-only exit", async (status) => {
    const { host, target, eventId } = await setup(status), stranger = await user();
    const id = await invite(eventId, host, target);
    expect((await accept(id, target)).canOpenEvent).toBe(false);
    const { accesses } = await json(await req("/me/event-access", target));
    expect(accesses).toHaveLength(1);
    expect(Object.keys(accesses[0]).sort()).toEqual(["canLeave", "canOpenEvent", "createdAt", "eventId", "id", "status"]);
    expect(accesses[0]).toMatchObject({ canOpenEvent: false, canLeave: true });
    for (const method of ["GET", "POST", "PATCH"]) expect((await req(`/events/${eventId}/access`, target, method)).status).toBe(404);
    expect((await leave(eventId, stranger)).status).toBe(404);
    await json(await leave(eventId, target));
    await json(await leave(eventId, target));
    expect((await req(`/events/${eventId}`, target)).status).toBe(404);
    expect((await json(await req("/me/event-access", target))).accesses).toEqual([]);
    expect((await req(`/events/${eventId}/access`, undefined, "DELETE", {})).headers.get("cache-control")).toBe("private, no-store");
  });

  it("revokes a pre-end confirmed registration atomically, frees the seat, promotes only an eligible waitlist user", async () => {
    const { host, target, eventId } = await setup(), revoked = await user(), waiting = await user();
    const id = await invite(eventId, host, target); await accept(id, target);
    const { slot } = await json(await req(`/events/${eventId}/slots`, host, "POST", { name: "Seat", capacity: 1, selectionType: "first_come" }), 201);
    await json(await req(`/events/${eventId}/join`, target, "POST", { slotId: slot.id }), 201);
    for (const u of [revoked, waiting]) { const i = await invite(eventId, host, u); await accept(i, u); await json(await req(`/events/${eventId}/join`, u, "POST", { slotId: slot.id }), 201); }
    // A stale waitlist history whose access was lost must not be promoted.
    await env.DB.prepare("UPDATE event_access_invite SET status = 'revoked' WHERE event_id = ? AND user_id = ?").bind(eventId, revoked.id).run();
    const rev = await revision(eventId, host);
    expect((await req(`/events/${eventId}/access-invites/${id}`, host, "DELETE", { expectedAccessRevision: rev })).status).toBe(400);
    await json(await req(`/events/${eventId}/access-invites/${id}`, host, "DELETE", { expectedAccessRevision: rev, confirmCancelParticipation: true }));
    const members = await env.DB.prepare("SELECT user_id,status FROM event_member WHERE event_id = ?").bind(eventId).all();
    expect(members.results).toContainEqual({ user_id: target.id, status: "canceled" });
    expect(members.results).toContainEqual({ user_id: revoked.id, status: "waitlist" });
    expect(members.results).toContainEqual({ user_id: waiting.id, status: "confirmed" });
    expect(await count("entry", eventId)).toBe(1);
    expect((await req(`/events/${eventId}`, target)).status).toBe(404);
    const next = await invite(eventId, host, target); expect(next).not.toBe(id); await accept(next, target);
    expect((await req(`/events/${eventId}`, target)).status).toBe(200);
  });

  it("after event end exit preserves registration/Entry history, and managers cannot self-revoke", async () => {
    const { host, target, eventId } = await setup();
    const id = await invite(eventId, host, target); await accept(id, target);
    await json(await req(`/events/${eventId}/join`, target, "POST", {}), 201);
    await env.DB.prepare("UPDATE event SET ends_at = ? WHERE id = ?").bind(Date.now() - 1, eventId).run();
    await json(await leave(eventId, target));
    expect(await count("entry", eventId)).toBe(1);
    expect(await count("event_member", eventId)).toBe(2);
    const next = await invite(eventId, host, target); await accept(next, target);
    await env.DB.prepare("UPDATE event_member SET role = 'staff' WHERE event_id = ? AND user_id = ?").bind(eventId, target.id).run();
    expect(await json(await leave(eventId, target), 409)).toEqual({ error: "managed_access" });
  });
  it("rolls back grant, membership, Entry and revision if cancellation fails midway", async () => {
    const { host, target, eventId } = await setup();
    const id = await invite(eventId, host, target); await accept(id, target);
    await json(await req(`/events/${eventId}/join`, target, "POST", {}), 201);
    const rev = await revision(eventId, host);
    await env.DB.exec("CREATE TRIGGER fail_exit BEFORE DELETE ON entry BEGIN SELECT RAISE(ABORT, 'exit test failure'); END");
    expect((await leave(eventId, target)).status).toBe(500);
    expect(await revision(eventId, host)).toBe(rev);
    expect(await count("entry", eventId)).toBe(1);
    expect((await json(await req(`/me/event-invites/${id}`, target))).status).toBe("accepted");
    expect((await env.DB.prepare("SELECT access_operation_token FROM event WHERE id = ?").bind(eventId).first())!.access_operation_token).toBeNull();
    await env.DB.exec("DROP TRIGGER fail_exit");
    await json(await leave(eventId, target));
  });

  it("rechecks private join at the write after revocation and creates no orphan Entry", async () => {
    const { host, target, eventId } = await setup();
    const id = await invite(eventId, host, target); await accept(id, target);
    expect((await req(`/events/${eventId}`, target)).status).toBe(200);
    await json(await leave(eventId, target));
    bindEnv(env as unknown as Env);
    expect(await joinPrivateEvent(eventId, target.id, null)).toBe(false);
    expect(await count("entry", eventId)).toBe(0);
    expect(await count("event_member", eventId)).toBe(1);
    expect((await req(`/events/${eventId}/join`, target, "POST", {})).status).toBe(404);
  });

  it("stale revisions cause no invitation side effects after a member change", async () => {
    const { host, target, eventId } = await setup(), joining = await user();
    const id = await invite(eventId, host, joining); await accept(id, joining);
    const rev = await revision(eventId, host), before = await count("notification", eventId);
    await json(await req(`/events/${eventId}/join`, joining, "POST", {}), 201);
    expect(await revision(eventId, host)).toBeGreaterThan(rev);
    expect(await json(await req(`/events/${eventId}/access-invites`, host, "POST", {
      handle: target.handle, expectedUserId: target.id, expectedAccessRevision: rev,
    }), 409)).toEqual({ error: "access_changed" });
    expect(await count("notification", eventId)).toBe(before);
  });

  it("accept/revoke and accept/reissue races never resurrect an old invitation", async () => {
    const { host, target, eventId } = await setup();
    const id = await invite(eventId, host, target), rev = await revision(eventId, host);
    const [accepted, revoked] = await Promise.all([
      req(`/me/event-invites/${id}/accept`, target, "POST", {}),
      req(`/events/${eventId}/access-invites/${id}`, host, "DELETE", { expectedAccessRevision: rev, confirmCancelParticipation: true }),
    ]);
    expect([200, 409]).toContain(accepted.status); expect([200, 409]).toContain(revoked.status);
    // A fresh explicit manager confirmation can revoke whichever operation won.
    await json(await req(`/events/${eventId}/access-invites/${id}`, host, "DELETE", {
      expectedAccessRevision: await revision(eventId, host), confirmCancelParticipation: true,
    }));
    expect((await req(`/me/event-invites/${id}/accept`, target, "POST", {})).status).toBe(409);
    expect((await req(`/events/${eventId}`, target)).status).toBe(404);
    const next = await invite(eventId, host, target), nextRev = await revision(eventId, host);
    const [a, r] = await Promise.all([
      req(`/me/event-invites/${next}/accept`, target, "POST", {}),
      req(`/events/${eventId}/access-invites/${next}/reissue`, host, "POST", { expectedAccessRevision: nextRev }),
    ]);
    if (r.status === 200) {
      expect(a.status).toBe(404);
      expect((await req(`/events/${eventId}`, target)).status).toBe(404);
    } else { expect(r.status).toBe(409); expect(a.status).toBe(200); }
    expect(await count("entry", eventId)).toBe(0);
  });

  it("concurrent private joins cannot overbook the final seat", async () => {
    const { host, target, eventId } = await setup(), second = await user();
    for (const u of [target, second]) await accept(await invite(eventId, host, u), u);
    const { slot } = await json(await req(`/events/${eventId}/slots`, host, "POST", { name: "One seat", capacity: 1, selectionType: "first_come" }), 201);
    const responses = await Promise.all([target, second].map((u) => req(`/events/${eventId}/join`, u, "POST", { slotId: slot.id })));
    const bodies = await Promise.all(responses.map((r) => json(r, 201)));
    expect(bodies.map((b) => b.status).sort()).toEqual(["confirmed", "waitlist"]);
    expect(await count("entry", eventId)).toBe(1);
  });

  it("keeps the normal request size cap on the pre-gate self-exit route", async () => {
    const { host, target, eventId } = await setup();
    const id = await invite(eventId, host, target); await accept(id, target);
    const before = await revision(eventId, host);
    expect((await req(`/events/${eventId}/access`, target, "DELETE", {
      confirmCancelParticipation: true, padding: "x".repeat(8 * 1024 * 1024),
    })).status).toBe(413);
    expect(await revision(eventId, host)).toBe(before);
    expect((await json(await req(`/me/event-invites/${id}`, target))).status).toBe("accepted");
  });

  it("overlapping self-exits both succeed with only one cleanup and promotion", async () => {
    const { host, target, eventId } = await setup(), waiting = await user();
    await accept(await invite(eventId, host, target), target);
    await accept(await invite(eventId, host, waiting), waiting);
    const { slot } = await json(await req(`/events/${eventId}/slots`, host, "POST", { name: "Seat", capacity: 1, selectionType: "first_come" }), 201);
    for (const u of [target, waiting]) await json(await req(`/events/${eventId}/join`, u, "POST", { slotId: slot.id }), 201);
    const before = await revision(eventId, host);
    bindEnv(env as unknown as Env);
    const original = eventAccessInvitesRepo.findForUser.bind(eventAccessInvitesRepo);
    let reads = 0, release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(eventAccessInvitesRepo, "findForUser").mockImplementation(async (...args) => {
      const row = await original(...args);
      if (++reads <= 2) { if (reads === 2) release(); await bothRead; }
      return row;
    });
    try {
      const send = () => app.request(`${base}/api/events/${eventId}/access`, { method: "DELETE",
        headers: { cookie: target.cookie, "content-type": "application/json" }, body: JSON.stringify({ confirmCancelParticipation: true }) }, env);
      for (const response of await Promise.all([send(), send()])) await json(response);
    } finally { spy.mockRestore(); }
    expect(reads).toBe(3); // two accepted snapshots, then one replay reread
    expect(await revision(eventId, host)).toBe(before + 1);
    expect(await count("entry", eventId)).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM notification WHERE event_id=? AND type='waitlist_promoted'").bind(eventId).first())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT status FROM event_member WHERE event_id=? AND user_id=?").bind(eventId, waiting.id).first())!.status).toBe("confirmed");
  });

  it("does not acknowledge a different reissued invitation as the completed exit", async () => {
    const { host, target, eventId } = await setup();
    const id = await invite(eventId, host, target); await accept(id, target);
    bindEnv(env as unknown as Env);
    const original = exits.revokeEventAccess;
    const spy = vi.spyOn(exits, "revokeEventAccess").mockImplementationOnce(async (row, actor) => {
      expect(await original(row, actor)).toBe(true);
      const rev = (await env.DB.prepare("SELECT access_revision r FROM event WHERE id=?").bind(eventId).first<{r:number}>())!.r;
      expect(await eventAccessInvitesRepo.issue(eventId, host.id, target.id, rev, target.handle)).toBeTruthy();
      return false; // another request revoked, then a manager reissued before our reread
    });
    try {
      const response = await app.request(`${base}/api/events/${eventId}/access`, { method: "DELETE",
        headers: { cookie: target.cookie, "content-type": "application/json" }, body: JSON.stringify({ confirmCancelParticipation: true }) }, env);
      expect(await json(response, 409)).toEqual({ error: "access_changed" });
    } finally { spy.mockRestore(); }
  });

});
