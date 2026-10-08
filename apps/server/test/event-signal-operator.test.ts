import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventSignalSource, EventSignalTopic } from "@eventer/shared";
import { eventSignal } from "../src/lib/eventSignal.js";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

/**
 * Operator refetch topics (D-POLL-MIN Phase 5b-2, docs/event-signal.md): `live`, `qa`,
 * `prize-desk`, `meet-ranking`, `bingo-staff`. The operator payloads carry where to listen,
 * and each committed change sends a `{rev}` signal naming the topics it touched (no data).
 * Requests through SELF run with an execution context, so the publish lands in waitUntil
 * after the response: `settled` waits for it; the publish mock reads the committed row.
 */

const BASE = "https://example.com";
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
afterEach(() => vi.restoreAllMocks());

async function makeUser() {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,global_name,created_at) VALUES(?,?,?,?,1)", id, `nostr:${id}`, `u_${id.slice(0, 8)}`, `n_${id.slice(0, 4)}`).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}

async function setup(columns: Record<string, string | number> = {}) {
  const staff = await makeUser(), member = await makeUser(), eventId = crypto.randomUUID(), now = Date.now();
  const extra = { chat_enabled: 1, qa_enabled: 1, meet_ranking: "anonymous", meet_prizes: 1, ...columns };
  await sql(
    `INSERT INTO event(id,title,starts_at,ends_at,venue_type,status,visibility,scheduling,created_by,created_at,${Object.keys(extra).join(",")})
     VALUES(?, 'Secret ceremony',?,?,'offline','published','public',0,?,?,${Object.keys(extra).map(() => "?").join(",")})`,
    eventId, now - 3600_000, now + 3600_000, staff.id, now, ...Object.values(extra),
  ).run();
  for (const [user, role] of [[staff, "staff"], [member, "participant"]] as const) {
    await sql("INSERT INTO event_member(id,event_id,user_id,role,status,attended,created_at) VALUES(?,?,?,?,'confirmed',0,1)", crypto.randomUUID(), eventId, user.id, role).run();
  }
  return { staff, member, eventId };
}

const json = (method: string, path: string, cookie: string, body?: unknown) => SELF.fetch(`${BASE}/api${path}`, {
  method, headers: { "content-type": "application/json", cookie, Origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body),
});
async function read<T>(path: string, cookie: string): Promise<T> {
  const res = await SELF.fetch(`${BASE}/api${path}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

const topicOf = (eventId: string, topic: EventSignalTopic) => eventSignal.config(eventId, topic, 1)!.topic;

/** Records the topics of every published signal and, read at publish time, `atPublish`
 * (the committed state the signal announces). */
function spyPublish(atPublish: () => Promise<unknown> = async () => null) {
  const sent: Array<{ topics: string[]; content: Record<string, unknown>; seen: unknown }> = [];
  const spy = vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relayUrls, signal): Promise<PublishReport> => {
    const entry = { topics: signal.tags.filter((t) => t[0] === "t").map((t) => t[1]), content: JSON.parse(signal.content), seen: undefined as unknown };
    entry.seen = await atPublish();
    sent.push(entry);
    return { ok: true, relays: relayUrls.map((url) => ({ url, outcome: "ok" as const })) };
  });
  return { sent, spy };
}

/** Waits for background publishes to land, then requires exactly `count` signals so far. */
async function settled(sent: unknown[], count: number) {
  await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(count));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(sent).toHaveLength(count);
}

function expectSource(source: EventSignalSource | null | undefined, eventId: string, topic: EventSignalTopic, before: number) {
  expect(source).toMatchObject({ kind: 20078, topic: topicOf(eventId, topic), relays: expect.any(Array) });
  expect(source!.rev).toBeGreaterThanOrEqual(before);
}

describe("operator payloads carry their refetch source", () => {
  it("live-state, questions, ranking, prize status and bingo status each name their topic", async () => {
    const { staff, eventId } = await setup();
    const before = Date.now();
    expectSource((await read<{ signal: EventSignalSource }>(`/events/${eventId}/live-state`, staff.cookie)).signal, eventId, "live", before);
    expectSource((await read<{ signal: EventSignalSource }>(`/events/${eventId}/questions`, staff.cookie)).signal, eventId, "qa", before);
    expectSource((await read<{ signal: EventSignalSource }>(`/events/${eventId}/meets/ranking/live`, staff.cookie)).signal, eventId, "meet-ranking", before);
    expectSource((await read<{ signal: EventSignalSource }>(`/events/${eventId}/meet-prizes/status`, staff.cookie)).signal, eventId, "prize-desk", before);
    expectSource((await read<{ signal: EventSignalSource }>(`/events/${eventId}/bingo/status`, staff.cookie)).signal, eventId, "bingo-staff", before);
  });

  it("staff topics stay in staff responses: participants are refused prize status and bingo status", async () => {
    const { member, eventId } = await setup();
    expect((await SELF.fetch(`${BASE}/api/events/${eventId}/meet-prizes/status`, { headers: { cookie: member.cookie } })).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/api/events/${eventId}/bingo/status`, { headers: { cookie: member.cookie } })).status).toBe(403);
    expect((await SELF.fetch(`${BASE}/api/events/${eventId}/live-state`, { headers: { cookie: member.cookie } })).status).toBe(403);
  });
});

describe("live", () => {
  it("a live-state PATCH and a cut-in each send one {rev} signal after commit; a refused write sends none", async () => {
    const { staff, member, eventId } = await setup();
    const { sent } = spyPublish(async () => (await sql("SELECT live_indicator_on FROM event_live_state WHERE event_id=?", eventId).first<{ live_indicator_on: number }>())?.live_indicator_on);
    expect((await json("PATCH", `/events/${eventId}/live-state`, staff.cookie, { liveIndicatorOn: true })).status).toBe(200);
    await settled(sent, 1);
    expect(sent[0]).toMatchObject({ topics: [topicOf(eventId, "live")], seen: 1 });
    expect(Object.keys(sent[0].content)).toEqual(["rev"]);
    expect((await json("PATCH", `/events/${eventId}/live-state`, member.cookie, { liveIndicatorOn: false })).status).toBe(403);
    await settled(sent, 1);
    expect((await json("POST", `/events/${eventId}/live-cutin`, staff.cookie, { message: "山田 参戦！！" })).status).toBe(201);
    await settled(sent, 2);
    expect(sent[1].topics).toEqual([topicOf(eventId, "live")]);
  });

  it("deleting the deck or live set on air signals each event showing it; an unused one signals nothing", async () => {
    const { staff, eventId } = await setup();
    const other = await setup();
    const deck = await (await json("POST", "/decks", staff.cookie, { title: "d" })).json() as { id: string };
    const set = await (await json("POST", "/live-sets", staff.cookie, { name: "s" })).json() as { id: string };
    expect((await json("PATCH", `/events/${eventId}/live-state`, staff.cookie, { deckId: deck.id, liveSetId: set.id })).status).toBe(200);
    const unused = await (await json("POST", "/decks", staff.cookie, { title: "u" })).json() as { id: string };

    const { sent } = spyPublish(async () => (await sql("SELECT deck_id, live_set_id FROM event_live_state WHERE event_id=?", eventId).first()));
    expect((await json("DELETE", `/decks/${unused.id}`, staff.cookie)).status).toBe(200);
    await settled(sent, 0);
    expect((await json("DELETE", `/decks/${deck.id}`, staff.cookie)).status).toBe(200);
    await settled(sent, 1);
    expect(sent[0]).toMatchObject({ topics: [topicOf(eventId, "live")], seen: { deck_id: null, live_set_id: set.id } });
    expect((await json("DELETE", `/live-sets/${set.id}`, staff.cookie)).status).toBe(200);
    await settled(sent, 2);
    expect(sent[1]).toMatchObject({ topics: [topicOf(eventId, "live")], seen: { deck_id: null, live_set_id: null } });
    expect(sent.flatMap((s) => s.topics)).not.toContain(topicOf(other.eventId, "live"));
  });

  it("event settings: a chat setting change signals live, Q&A and ranking settings signal their topic, others none", async () => {
    const { staff, eventId } = await setup();
    const { sent } = spyPublish();
    expect((await json("PATCH", `/events/${eventId}`, staff.cookie, { description: "changed" })).status).toBe(200);
    await settled(sent, 0);
    expect((await json("PATCH", `/events/${eventId}`, staff.cookie, { chatEnabled: false })).status).toBe(200);
    await settled(sent, 1);
    expect(sent.at(-1)!.topics).toEqual([topicOf(eventId, "live")]);
    expect((await json("PATCH", `/events/${eventId}`, staff.cookie, { qaEnabled: false, meetRanking: "named" })).status).toBe(200);
    await settled(sent, 2);
    expect(sent.at(-1)!.topics).toEqual([topicOf(eventId, "qa"), topicOf(eventId, "meet-ranking")]);
  });
});

describe("qa", () => {
  it("posts, votes, moderation and pick signal qa after commit; refused writes send none", async () => {
    const { staff, member, eventId } = await setup();
    const outsider = await makeUser();
    const { sent } = spyPublish(async () => (await sql("SELECT COUNT(*) AS n FROM event_question WHERE event_id=?", eventId).first<{ n: number }>())!.n);
    const created = await json("POST", `/events/${eventId}/questions`, member.cookie, { body: "質問です", anonymous: false });
    expect(created.status).toBe(201);
    await settled(sent, 1);
    expect(sent).toEqual([{ topics: [topicOf(eventId, "qa")], content: { rev: expect.any(Number) }, seen: 1 }]);
    const { question } = (await created.json()) as { question: { id: string } };
    expect((await json("POST", `/events/${eventId}/questions`, outsider.cookie, { body: "x", anonymous: false })).status).toBe(403);
    await settled(sent, 1);
    // Votes go through the throttle: the post above opened this event's qa window, so the
    // vote is one trailing signal at the end of the window (SIGNAL_THROTTLE_MS)
    expect((await json("POST", `/events/${eventId}/questions/${question.id}/vote`, staff.cookie)).status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 4000 });
    for (const s of sent) expect(s.topics).toEqual([topicOf(eventId, "qa")]);
    expect((await json("PUT", `/events/${eventId}/qa/pick`, staff.cookie, { questionId: question.id })).status).toBe(200);
    await settled(sent, 3);
    expect((await json("PATCH", `/events/${eventId}/questions/${question.id}`, staff.cookie, { hidden: true })).status).toBe(200);
    await settled(sent, 4);
  });
});

describe("prize-desk", () => {
  it("prize create, redeem, unredeem and delete each signal the desk after commit; a refused redeem sends none", async () => {
    const { staff, member, eventId } = await setup();
    const [low, high] = [staff.id, member.id].sort();
    await sql("INSERT INTO event_meet(id,event_id,user_low,user_high,created_at) VALUES(?,?,?,?,1)", crypto.randomUUID(), eventId, low, high).run();
    const { sent } = spyPublish(async () => (await sql("SELECT COUNT(*) AS n FROM event_prize_redemption r JOIN event_prize p ON p.id=r.prize_id WHERE p.event_id=?", eventId).first<{ n: number }>())!.n);
    const res = await json("POST", `/events/${eventId}/meet-prizes`, staff.cookie, { name: "p", description: "", conditionType: "meet_count", threshold: 1, stock: 5 });
    expect(res.status).toBe(201);
    const { prize } = (await res.json()) as { prize: { id: string } };
    await settled(sent, 1);
    expect(sent[0]).toMatchObject({ topics: [topicOf(eventId, "prize-desk")], seen: 0 });
    expect((await json("POST", `/events/${eventId}/meet-prizes/${prize.id}/redeem`, member.cookie, { userId: member.id })).status).toBe(403);
    await settled(sent, 1);
    expect((await json("POST", `/events/${eventId}/meet-prizes/${prize.id}/redeem`, staff.cookie, { userId: member.id })).status).toBe(201);
    await settled(sent, 2);
    expect(sent[1]).toMatchObject({ topics: [topicOf(eventId, "prize-desk")], seen: 1 });
    expect((await json("POST", `/events/${eventId}/meet-prizes/${prize.id}/redeem`, staff.cookie, { userId: member.id })).status).toBe(409);
    await settled(sent, 2); // already redeemed: nothing changed, nothing sent
    expect((await json("DELETE", `/events/${eventId}/meet-prizes/${prize.id}/redeem/${member.id}`, staff.cookie)).status).toBe(200);
    await settled(sent, 3);
    expect(sent[2].seen).toBe(0);
    expect((await json("DELETE", `/events/${eventId}/meet-prizes/${prize.id}`, staff.cookie)).status).toBe(200);
    await settled(sent, 4);
  });
});

describe("meet-ranking", () => {
  it("a scan that records a meet signals ranking and desk for that event; repeating it records nothing and sends nothing", async () => {
    const { staff, member, eventId } = await setup();
    const { token } = await read<{ token: string }>("/meet/token", member.cookie);
    const { sent } = spyPublish(async () => (await sql("SELECT COUNT(*) AS n FROM event_meet WHERE event_id=?", eventId).first<{ n: number }>())!.n);
    expect((await json("POST", "/meet/scan", staff.cookie, { token })).status).toBe(200);
    await settled(sent, 1);
    expect(sent[0]).toMatchObject({ topics: [topicOf(eventId, "meet-ranking"), topicOf(eventId, "prize-desk")], seen: 1 });
    expect(JSON.stringify(sent)).not.toContain(eventId);
    const { token: again } = await read<{ token: string }>("/meet/token", member.cookie);
    expect((await json("POST", "/meet/scan", staff.cookie, { token: again })).status).toBe(200);
    await settled(sent, 1); // already met: no new meet row, no signal
  });
});

describe("bingo-staff", () => {
  it("create, card issue, start, draw and end signal the draw control; draws also signal the desk", async () => {
    const { staff, member, eventId } = await setup();
    const { sent } = spyPublish(async () => (await sql("SELECT drawn_count FROM event_bingo_game WHERE event_id=?", eventId).first<{ drawn_count: number }>())?.drawn_count ?? null);
    const staffOnly = [topicOf(eventId, "bingo-staff")];
    const withDesk = [topicOf(eventId, "bingo-staff"), topicOf(eventId, "prize-desk")];
    expect((await json("POST", `/events/${eventId}/bingo`, staff.cookie, {})).status).toBe(201);
    await settled(sent, 1);
    expect(sent.at(-1)!.topics).toEqual(staffOnly);
    expect((await json("POST", `/events/${eventId}/bingo/card`, member.cookie, {})).status).toBe(200);
    await settled(sent, 2);
    expect(sent.at(-1)!.topics).toEqual(staffOnly);
    expect((await json("POST", `/events/${eventId}/bingo/start`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 3);
    expect(sent.at(-1)!.topics).toEqual(staffOnly);
    expect((await json("POST", `/events/${eventId}/bingo/draw`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 4);
    expect(sent.at(-1)).toMatchObject({ topics: withDesk, seen: 1 });
    expect((await json("POST", `/events/${eventId}/bingo/draw`, member.cookie, {})).status).toBe(403);
    await settled(sent, 4);
    expect((await json("POST", `/events/${eventId}/bingo/end`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 5);
    expect(sent.at(-1)!.topics).toEqual(withDesk);
    for (const s of sent) expect(Object.keys(s.content)).toEqual(["rev"]);
  });
});
