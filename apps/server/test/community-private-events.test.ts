import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";

const sql = (q: string, ...args: unknown[]) => env.DB.prepare(q).bind(...args).run();
async function user(discordId?: string) {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,1)", id, discordId ?? id, id);
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", sid, id, Date.now() + 86400000);
  return { id, cookie: `eventer_session=${sid}` };
}
type Actor = Awaited<ReturnType<typeof user>>;
const request = (path: string, actor?: Actor, method = "GET") => SELF.fetch(`https://example.com/api/public${path}`, {
  method, headers: actor ? { cookie: actor.cookie } : {},
});
async function get(path: string, actor?: Actor) {
  const response = await request(path, actor);
  expect(response.status).toBe(200);
  return await response.json() as any;
}
const member = (event: string, actor: Actor, status = "confirmed", role = "participant") => sql(
  "INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,?,?,1)", crypto.randomUUID(), event, actor.id, role, status,
);
const grant = (event: string, actor: Actor) => sql(
  "INSERT INTO event_access_invite(id,event_id,user_id,status,source,created_at) VALUES(?,?,?,'accepted','invite',1)", crypto.randomUUID(), event, actor.id,
);
async function fixture() {
  const owner = await user();
  await sql("INSERT INTO community(id,slug,name,owner_id,created_at) VALUES('group','group','Group',?,1)", owner.id);
  await sql("INSERT INTO community_member(id,community_id,user_id,role,created_at) VALUES('owner','group',?,'owner',1)", owner.id);
  const event = async (visibility: string, status = "published", scheduling = 0, endsAt = 2) => {
    const id = crypto.randomUUID();
    await sql("INSERT INTO event(id,title,community_id,created_by,created_at,starts_at,ends_at,venue_type,status,visibility,scheduling) VALUES(?,?,'group',?,1,1,?,'online',?,?,?)", id, `${visibility} ${id}`, owner.id, endsAt, status, visibility, scheduling);
    return id;
  };
  return { owner, event };
}

it("public aggregate counts private/unlisted confirmed people once, without publishing names or affiliations", async () => {
  const { event } = await fixture();
  const publicEvent = await event("public"), privateEvent = await event("private"), unlisted = await event("unlisted");
  const publicPerson = await user(), hiddenPerson = await user(), unlistedPerson = await user();
  await member(publicEvent, publicPerson);
  await member(privateEvent, hiddenPerson);
  await member(unlisted, unlistedPerson);
  // Same person across events and explicit membership is still one person.
  await member(privateEvent, publicPerson);
  await member(unlisted, hiddenPerson);
  await sql("INSERT INTO community_member(id,community_id,user_id,role,created_at) VALUES('duplicate','group',?,'member',1)", publicPerson.id);
  for (const status of ["waitlist", "applied", "lost", "canceled"]) await member(privateEvent, await user(), status);
  for (const status of ["draft", "archived"]) await member(await event("private", status), await user());
  const deleted = await user();
  await member(privateEvent, deleted);
  await sql("UPDATE user SET deleted_at=1 WHERE id=?", deleted.id);

  const detail = await get("/communities/group");
  expect(detail).toMatchObject({ memberCount: 4, eventCount: 1 }); // owner + three unique participants
  expect(detail.pastEvents.map((e: any) => e.id)).toEqual([publicEvent]);
  expect((await get("/communities")).communities[0]).toMatchObject({ memberCount: 4, eventCount: 1 });
  const roster = await get("/communities/group/members");
  expect(roster.members).toHaveLength(2);
  expect(JSON.stringify(roster)).not.toContain(hiddenPerson.id);
  expect(JSON.stringify(roster)).not.toContain(unlistedPerson.id);
  expect((await get(`/users/${hiddenPerson.id}`, hiddenPerson)).communities).toEqual([]);
  const search = await get("/communities/group/events?phase=past");
  expect(search).toMatchObject({ total: 1, hasMore: false });
  expect(search.events.map((e: any) => e.id)).toEqual([publicEvent]);
});

it("authorized past private appears in the actual community search and header, never ordinary search", async () => {
  const { owner, event } = await fixture();
  const pub = await event("public"), hidden = await event("private");
  await event("private", "draft"); await event("private", "archived");
  const accepted = await user(), staff = await user(), outsider = await user(), communityMember = await user();
  await grant(hidden, accepted); await member(hidden, accepted);
  await member(hidden, staff, "confirmed", "staff");
  await sql("INSERT INTO community_member(id,community_id,user_id,role,created_at) VALUES('ordinary','group',?,'member',1)", communityMember.id);
  const admin = await user("dev-user");
  for (const actor of [accepted, staff, owner, admin]) {
    const page = await get("/communities/group/events?phase=past&limit=1", actor);
    expect(page).toMatchObject({ total: 2, hasMore: true });
    const next = await get("/communities/group/events?phase=past&limit=1&page=2", actor);
    expect(next).toMatchObject({ total: 2, hasMore: false });
    expect([...page.events, ...next.events].map((e: any) => e.id).sort()).toEqual([pub, hidden].sort());
    const detail = await get("/communities/group", actor);
    expect(detail.eventCount).toBe(2);
    expect(detail.pastEvents.map((e: any) => e.id).sort()).toEqual([pub, hidden].sort());
    const ordinary = await get("/events/search?communityId=group&phase=past", actor);
    expect(ordinary.total).toBe(1);
    expect(ordinary.events.map((e: any) => e.id)).toEqual([pub]);
  }
  for (const actor of [undefined, outsider, communityMember]) {
    expect((await get("/communities/group", actor)).eventCount).toBe(1);
    const page = await get("/communities/group/events?phase=past", actor);
    expect(page.total).toBe(1); expect(page.events.map((e: any) => e.id)).toEqual([pub]);
  }
  const count = (await get("/communities/group")).memberCount;
  await sql("UPDATE event_access_invite SET status='revoked' WHERE event_id=?", hidden);
  expect((await get("/communities/group/events?phase=past", accepted)).events.map((e: any) => e.id)).toEqual([pub]);
  expect(await get("/communities/group", accepted)).toMatchObject({ eventCount: 1, memberCount: count });
  // Revocation is viewing loss, not deletion of historical confirmed participation.
  expect(await env.DB.prepare("SELECT status FROM event_member WHERE event_id=? AND user_id=?").bind(hidden, accepted.id).first()).toEqual({ status: "confirmed" });
});

it("community scope, phase/filter pagination and response privacy remain server-controlled", async () => {
  const { owner, event } = await fixture();
  const past = await event("private"), upcoming = await event("private", "published", 0, Date.now() + 86400000);
  const scheduling = await event("private", "published", 1, 0);
  for (const [phase, id] of [["past", past], ["upcoming", upcoming], ["scheduling", scheduling]]) {
    const page = await get(`/communities/group/events?phase=${phase}&communityId=other`, owner);
    expect(page.total).toBe(1); expect(page.events.map((e: any) => e.id)).toEqual([id]);
  }
  expect((await get(`/communities/group/events?q=${past}&phase=past`, owner)).total).toBe(1);
  expect((await get("/communities/group/events?phase=past&from=3", owner)).total).toBe(0);
  for (const path of ["/communities/group", "/communities/group/events?phase=past"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await request(path, owner, method);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toMatch(/Cookie/i);
      await response.text();
    }
  }
  const missing = await request("/communities/missing/events", owner);
  expect(missing.status).toBe(404); await missing.text();
});

it("unlisted discovery requires existing participation or management in every community phase", async () => {
  const { owner, event } = await fixture();
  const participant = await user(), staff = await user(), communityAdmin = await user(), admin = await user("dev-user");
  const outsider = await user(), canceled = await user(), communityMember = await user(), deleted = await user();
  for (const [actor, role] of [[communityAdmin, "admin"], [communityMember, "member"]] as const) {
    await sql("INSERT INTO community_member(id,community_id,user_id,role,created_at) VALUES(?,'group',?,?,1)", crypto.randomUUID(), actor.id, role);
  }
  const phases = [
    ["past", await event("unlisted")],
    ["upcoming", await event("unlisted", "published", 0, Date.now() + 86400000)],
    ["scheduling", await event("unlisted", "published", 1, 0)],
  ] as const;
  await event("unlisted", "draft"); await event("unlisted", "archived");
  for (const [, id] of phases) {
    await member(id, participant);
    await member(id, staff, "confirmed", "staff");
    await member(id, canceled, "canceled");
    await member(id, deleted);
  }
  await sql("UPDATE user SET deleted_at=1 WHERE id=?", deleted.id);
  for (const actor of [participant, staff, owner, communityAdmin, admin]) {
    for (const [phase, id] of phases) {
      const page = await get(`/communities/group/events?phase=${phase}`, actor);
      expect(page).toMatchObject({ total: 1, hasMore: false });
      expect(page.events.map((e: any) => e.id)).toEqual([id]);
      expect((await get(`/events/search?communityId=group&phase=${phase}`, actor)).total).toBe(0);
    }
    const detail = await get("/communities/group", actor);
    expect(detail.eventCount).toBe(3);
    expect(detail.pastEvents.map((e: any) => e.id)).toEqual([phases[0][1]]);
    expect(detail.upcomingEvents.map((e: any) => e.id).sort()).toEqual([phases[1][1], phases[2][1]].sort());
    const first = await get("/communities/group/events?limit=2", actor);
    const last = await get("/communities/group/events?limit=2&page=2", actor);
    expect(first).toMatchObject({ total: 3, hasMore: true });
    expect(last).toMatchObject({ total: 3, hasMore: false });
    expect([...first.events, ...last.events].map((e: any) => e.id).sort()).toEqual(phases.map(([, id]) => id).sort());
  }
  for (const actor of [undefined, outsider, canceled, communityMember, deleted]) {
    for (const [phase] of phases) {
      expect(await get(`/communities/group/events?phase=${phase}`, actor)).toMatchObject({ events: [], total: 0, hasMore: false });
    }
    expect(await get("/communities/group", actor)).toMatchObject({ eventCount: 0, upcomingEvents: [], pastEvents: [] });
  }
  // Match existing self-list status semantics, not just confirmed participants.
  for (const status of ["waitlist", "applied", "lost", "canceled"]) {
    await sql("UPDATE event_member SET status=? WHERE user_id=?", status, participant.id);
    expect((await get("/communities/group/events", participant)).total).toBe(status === "canceled" ? 0 : 3);
  }
});
