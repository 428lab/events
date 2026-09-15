import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createEventInput, type Event } from "@eventer/shared";
import { eventsRepo } from "../src/db/repositories/events.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";
import { bindEnv, type Env } from "../src/runtime.js";

const now = Date.now();
const events: Event[] = [];
let ownerId: string;
let communityId: string;

async function user() {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, `fixture:${id}`, id, now).run();
  return id;
}

beforeAll(async () => {
  bindEnv(env as unknown as Env);
  ownerId = await user();
  communityId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO community (id, slug, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(communityId, communityId, "visibility-fixture", ownerId, now).run();
  for (const visibility of ["public", "unlisted", "private"] as const) {
    const event = await eventsRepo.create(createEventInput.parse({
      title: `visibility-${visibility}`, visibility, communityId,
      venueType: "online", startsAt: now + 86_400_000, endsAt: now + 172_800_000,
    }), ownerId);
    await env.DB.prepare("UPDATE event SET status = 'published' WHERE id = ?").bind(event.id).run();
    events.push(event);
  }
});

function onlyPublic(rows: Event[]) {
  expect(rows.map((e) => e.id)).toEqual([events[0]!.id]);
}

describe("eventsRepo public discovery excludes nonpublic before pagination and counts", () => {
  it("upcoming, community and authenticated general lists include only public", async () => {
    onlyPublic(await eventsRepo.listPublished());
    onlyPublic(await eventsRepo.listByCommunity(communityId));
    onlyPublic(await eventsRepo.listUpcomingPublished(now, 10, 0));
    expect(await eventsRepo.countUpcomingPublished(now)).toBe(1);
    expect(await eventsRepo.listUpcomingPublished(now, 10, 1)).toEqual([]);
  });

  it("search totals and results use the same visibility predicate", async () => {
    const options = { q: "visibility-", communityId, limit: 10, offset: 0 };
    onlyPublic(await eventsRepo.searchPublished(options));
    expect(await eventsRepo.countSearchPublished(options)).toBe(1);
    expect(await eventsRepo.searchPublished({ ...options, offset: 1 })).toEqual([]);
  });

  it("past and scheduling collections retain the public-only condition", async () => {
    await env.DB.prepare("UPDATE event SET starts_at = ?, ends_at = ? WHERE community_id = ?")
      .bind(now - 2000, now - 1000, communityId).run();
    onlyPublic(await eventsRepo.listPastPublished(now, 10, 0));
    expect(await eventsRepo.countPastPublished(now)).toBe(1);
    await env.DB.prepare("UPDATE event SET scheduling = 1 WHERE community_id = ?").bind(communityId).run();
    onlyPublic(await eventsRepo.listSchedulingPublished(10, 0));
    expect(await eventsRepo.countSchedulingPublished()).toBe(1);
  });

  it.each(["/api/public/events", "/api/public/events/search?q=visibility-", "/feed/events.rss", "/feed/events.json", "/feed/events.ics"])("%s contains neither nonpublic title nor ID", async (path) => {
    const res = await SELF.fetch(`https://example.com${path}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(events[0]!.title);
    for (const event of events.slice(1)) {
      expect(body).not.toContain(event.id);
      expect(body).not.toContain(event.title);
    }
  });
});

describe("accountMerge viewing-grant conflict precedence", () => {
  it.each([
    ["accepted", "revoked", "loser"],
    ["revoked", "accepted", "winner"],
    ["declined", "pending", "loser"],
    ["pending", "accepted", "loser"],
    ["pending", "pending", "loser"],
  ])("%s vs %s preserves %s's grant, not an older privilege", async (winnerStatus, loserStatus, expected) => {
    const winner = await user();
    const loser = await user();
    const ids = { winner: crypto.randomUUID(), loser: crypto.randomUUID() };
    for (const [key, id, status, expiry] of [
      ["winner", winner, winnerStatus, now + 1000],
      ["loser", loser, loserStatus, now + 2000],
    ] as const) {
      await env.DB.prepare(`INSERT INTO event_access_invite
        (id, event_id, user_id, invited_by, status, source, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 'invite', ?, ?)`)
        .bind(ids[key], events[2]!.id, id, loser, status, now, expiry).run();
    }
    await accountMergeRepo.mergeUsers(winner, loser);
    const rows = await env.DB.prepare("SELECT id, user_id, invited_by FROM event_access_invite WHERE event_id = ?")
      .bind(events[2]!.id).all();
    expect(rows.results).toEqual([{ id: ids[expected as keyof typeof ids], user_id: winner, invited_by: winner }]);
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});
