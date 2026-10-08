import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BingoState, EventSignalSource, EventSignalTopic, EventState, ScoreSummary } from "@eventer/shared";
import { eventSignal } from "../src/lib/eventSignal.js";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

/**
 * Participant refetch topics (D-POLL-MIN Phase 5b-3, docs/event-signal.md): `event-state`
 * (contest progress and the awards announcement, D10 folded awards-sync into it), `scores`
 * (/control) and `bingo` (card page and projector). Each payload carries where to listen;
 * each committed change sends one `{rev}` signal naming the topics it touched (no data).
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

async function setup() {
  const staff = await makeUser(), member = await makeUser(), eventId = crypto.randomUUID(), now = Date.now();
  await sql(
    `INSERT INTO event(id,title,starts_at,ends_at,venue_type,status,visibility,scheduling,created_by,created_at,contest_mode)
     VALUES(?, 'Secret contest',?,?,'offline','published','public',0,?,?,1)`,
    eventId, now - 3600_000, now + 3600_000, staff.id, now,
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

function spyPublish(atPublish: () => Promise<unknown> = async () => null) {
  const sent: Array<{ topics: string[]; content: Record<string, unknown>; seen: unknown; protected: boolean }> = [];
  vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relayUrls, signal): Promise<PublishReport> => {
    const entry = {
      topics: signal.tags.filter((t) => t[0] === "t").map((t) => t[1]),
      content: JSON.parse(signal.content),
      seen: undefined as unknown,
      protected: signal.tags.some((t) => t[0] === "-"),
    };
    entry.seen = await atPublish();
    sent.push(entry);
    return { ok: true, relays: relayUrls.map((url) => ({ url, outcome: "ok" as const })) };
  });
  return { sent };
}

async function settled(sent: unknown[], count: number) {
  await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(count));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(sent).toHaveLength(count);
}

function expectSource(source: EventSignalSource | null | undefined, eventId: string, topic: EventSignalTopic, before: number) {
  expect(source).toMatchObject({ kind: 20078, topic: topicOf(eventId, topic), relays: expect.any(Array) });
  expect(source!.rev).toBeGreaterThanOrEqual(before);
}

describe("event-state", () => {
  it("GET /state names the topic for every viewer; the topic does not move when someone joins", async () => {
    const { staff, member, eventId } = await setup();
    const before = Date.now();
    const forMember = (await read<EventState>(`/events/${eventId}/state`, member.cookie)).signal;
    expectSource(forMember, eventId, "event-state", before);
    expect((await read<EventState>(`/events/${eventId}/state`, staff.cookie)).signal!.topic).toBe(forMember!.topic);
    // awards-sync salted its topic with accessRevision, which every join bumps (#538)
    await sql("UPDATE event SET access_revision = access_revision + 1 WHERE id = ?", eventId).run();
    expect((await read<EventState>(`/events/${eventId}/state`, member.cookie)).signal!.topic).toBe(forMember!.topic);
  });

  it("mode, presenting, scoring lock and awards advance/reset each send one protected {rev} signal after commit", async () => {
    const { staff, member, eventId } = await setup();
    const { sent } = spyPublish(async () => await sql("SELECT mode, scoring_locked, awards_reveal_cursor FROM event_state WHERE event_id=?", eventId).first());
    const only = [topicOf(eventId, "event-state")];
    expect((await json("PATCH", `/events/${eventId}/state/mode`, staff.cookie, { mode: "presentation" })).status).toBe(200);
    await settled(sent, 1);
    expect(sent[0]).toMatchObject({ topics: only, protected: true, seen: { mode: "presentation" } });
    expect(Object.keys(sent[0].content)).toEqual(["rev"]);
    expect((await json("PATCH", `/events/${eventId}/state/presenting`, staff.cookie, { presentingEntryId: null })).status).toBe(200);
    await settled(sent, 2);
    expect((await json("POST", `/events/${eventId}/state/scoring-lock`, staff.cookie)).status).toBe(200);
    await settled(sent, 3);
    expect(sent[2].seen).toMatchObject({ scoring_locked: 1 });
    expect((await json("POST", `/events/${eventId}/state/awards-advance`, staff.cookie)).status).toBe(200);
    await settled(sent, 4);
    expect(sent[3]).toMatchObject({ topics: only, seen: { awards_reveal_cursor: 1 } });
    expect((await json("POST", `/events/${eventId}/state/awards-reset`, staff.cookie)).status).toBe(200);
    await settled(sent, 5);
    expect(sent[4]).toMatchObject({ topics: only, seen: { awards_reveal_cursor: 0 } });
    // refused writes send nothing
    expect((await json("PATCH", `/events/${eventId}/state/mode`, member.cookie, { mode: "normal" })).status).toBe(403);
    expect((await json("POST", `/events/${eventId}/state/awards-advance`, member.cookie)).status).toBe(403);
    await settled(sent, 5);
  });

  it("the separate awards-sync endpoint is gone", async () => {
    const { member, eventId } = await setup();
    expect((await SELF.fetch(`${BASE}/api/events/${eventId}/awards-sync`, { headers: { cookie: member.cookie } })).status).toBe(404);
  });
});

describe("scores", () => {
  it("the staff summary names the topic; criteria changes and score submissions signal it", async () => {
    const { staff, member, eventId } = await setup();
    const before = Date.now();
    expectSource((await read<ScoreSummary>(`/events/${eventId}/scores/summary`, staff.cookie)).signal, eventId, "scores", before);
    expect((await SELF.fetch(`${BASE}/api/events/${eventId}/scores/summary`, { headers: { cookie: member.cookie } })).status).toBe(403);
    // the participant-facing state never carries the staff topic
    expect(JSON.stringify(await read(`/events/${eventId}/state`, member.cookie))).not.toContain(topicOf(eventId, "scores"));

    const { sent } = spyPublish();
    const only = [topicOf(eventId, "scores")];
    const created = await json("POST", `/events/${eventId}/criteria`, staff.cookie, { name: "技術" });
    expect(created.status).toBe(201);
    const { criterion } = (await created.json()) as { criterion: { id: string } };
    await settled(sent, 1);
    expect(sent[0].topics).toEqual(only);

    const entryId = crypto.randomUUID();
    await sql("INSERT INTO entry (id, event_id, kind, name, created_at) VALUES (?, ?, 'individual', 'Entry', 1)", entryId, eventId).run();
    expect((await json("PUT", `/events/${eventId}/scores`, member.cookie, { entryId, criterionId: criterion.id, value: 3 })).status).toBe(200);
    await settled(sent, 2);
    expect(sent[1].topics).toEqual(only);

    expect((await json("PATCH", `/events/${eventId}/criteria/${criterion.id}`, staff.cookie, { name: "技術力" })).status).toBe(200);
    await vi.waitFor(() => expect(sent.length).toBe(3));
    expect((await json("DELETE", `/events/${eventId}/criteria/${criterion.id}`, staff.cookie)).status).toBe(200);
    await settled(sent, 4);
    for (const s of sent) expect(Object.keys(s.content)).toEqual(["rev"]);
  });
});

describe("bingo", () => {
  it("GET /bingo names the topic for confirmed members, also before the game exists (#436)", async () => {
    const { staff, member, eventId } = await setup();
    const before = Date.now();
    const none = await read<BingoState>(`/events/${eventId}/bingo`, member.cookie);
    expect(none.status).toBe("none");
    expectSource(none.signal, eventId, "bingo", before);
    expect((await json("POST", `/events/${eventId}/bingo`, staff.cookie, {})).status).toBe(201);
    expectSource((await read<BingoState>(`/events/${eventId}/bingo`, member.cookie)).signal, eventId, "bingo", before);
  });

  it("create/start/draw/undo/end/reset/delete signal the cards; card issue signals only the draw control", async () => {
    const { staff, member, eventId } = await setup();
    const { sent } = spyPublish(async () => await sql("SELECT drawn_count, card_count FROM event_bingo_game WHERE event_id=?", eventId).first());
    const cards = topicOf(eventId, "bingo"), control = topicOf(eventId, "bingo-staff"), desk = topicOf(eventId, "prize-desk");
    expect((await json("POST", `/events/${eventId}/bingo`, staff.cookie, {})).status).toBe(201);
    await settled(sent, 1);
    expect(sent.at(-1)!.topics).toEqual([control, cards]);
    expect((await json("POST", `/events/${eventId}/bingo/card`, member.cookie, {})).status).toBe(200);
    await settled(sent, 2);
    expect(sent.at(-1)!.topics).toEqual([control]); // 10,000 card issues must not wake 10,000 cards
    expect((await json("POST", `/events/${eventId}/bingo/start`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 3);
    expect(sent.at(-1)!.topics).toEqual([control, cards]);
    expect((await json("POST", `/events/${eventId}/bingo/draw`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 4);
    // the stored counts are written before the signal, so a woken card reads this draw's numbers
    expect(sent.at(-1)).toMatchObject({ topics: [control, cards, desk], seen: { drawn_count: 1, card_count: 1 } });
    expect((await json("POST", `/events/${eventId}/bingo/draw/undo`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 5);
    expect(sent.at(-1)!.topics).toEqual([control, cards, desk]);
    expect((await json("POST", `/events/${eventId}/bingo/end`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 6);
    expect((await json("POST", `/events/${eventId}/bingo/reset`, staff.cookie, {})).status).toBe(200);
    await settled(sent, 7);
    expect(sent.at(-1)!.topics).toEqual([control, cards, desk]);
    expect((await json("DELETE", `/events/${eventId}/bingo`, staff.cookie)).status).toBe(200);
    await settled(sent, 8);
    expect(sent.at(-1)!.topics).toEqual([control, cards, desk]);
    for (const s of sent) expect(Object.keys(s.content)).toEqual(["rev"]);
  });
});

describe("bingo stored counts (D3, migration 0109)", () => {
  /** Fixed draw order (prefix first) so outcomes are deterministic */
  async function fixOrder(eventId: string, prefix: number[]) {
    const rest = Array.from({ length: 75 }, (_v, i) => i + 1).filter((n) => !prefix.includes(n));
    await sql("UPDATE event_bingo_game SET draw_order = ? WHERE event_id = ?", JSON.stringify([...prefix, ...rest]), eventId).run();
  }
  /** Overwrites a member's issued card: B column = first5, other columns fixed */
  async function setCard(eventId: string, userId: string, first5: number[]) {
    const numbers = [...first5, 16, 17, 18, 19, 20, 31, 32, 33, 34, 46, 47, 48, 49, 50, 61, 62, 63, 64, 65];
    await sql("UPDATE event_bingo_card SET numbers = ? WHERE event_id = ? AND user_id = ?", JSON.stringify(numbers), eventId, userId).run();
  }

  it("GET /bingo reads the stored counts and rank; draws and undo rewrite them, card issue adds itself", async () => {
    const { staff, member, eventId } = await setup();
    const other = await makeUser(), late = await makeUser();
    for (const user of [other, late]) {
      await sql("INSERT INTO event_member(id,event_id,user_id,role,status,attended,created_at) VALUES(?,?,?,'participant','confirmed',0,1)", crypto.randomUUID(), eventId, user.id).run();
    }
    expect((await json("POST", `/events/${eventId}/bingo`, staff.cookie, {})).status).toBe(201);
    for (const user of [member, other]) expect((await json("POST", `/events/${eventId}/bingo/card`, user.cookie, {})).status).toBe(200);
    const stored = () => sql("SELECT card_count, bingo_count, reach_count, bingo_by_seq FROM event_bingo_game WHERE event_id=?", eventId).first();
    expect(await stored()).toMatchObject({ card_count: 2, bingo_count: 0 });
    // the same member taking a card again changes nothing (idempotent issue)
    expect((await json("POST", `/events/${eventId}/bingo/card`, member.cookie, {})).status).toBe(200);
    expect(await stored()).toMatchObject({ card_count: 2 });

    expect((await json("POST", `/events/${eventId}/bingo/start`, staff.cookie, {})).status).toBe(200);
    await fixOrder(eventId, [1, 2, 3, 4, 5, 6]);
    await setCard(eventId, member.id, [1, 2, 3, 4, 5]); // bingo at draw 5
    await setCard(eventId, other.id, [1, 2, 3, 4, 7]); // reach from draw 4
    for (let i = 0; i < 5; i++) expect((await json("POST", `/events/${eventId}/bingo/draw`, staff.cookie, {})).status).toBe(200);
    expect(await stored()).toMatchObject({ card_count: 2, bingo_count: 1, reach_count: 1, bingo_by_seq: "[0,0,0,0,1]" });

    // a card issued after the draws counts its own outcome without reading every card
    expect((await json("POST", `/events/${eventId}/bingo/card`, late.cookie, {})).status).toBe(200);
    expect(await stored()).toMatchObject({ card_count: 3 });

    const mine = await read<BingoState>(`/events/${eventId}/bingo`, member.cookie);
    expect(mine.counts).toEqual({ cards: 3, bingo: 1, reach: 1 });
    expect(mine.me).toEqual({ bingo: true, reach: false, rank: 1 });

    // stored values match what the staff list derives from every card
    const undo = await json("POST", `/events/${eventId}/bingo/draw/undo`, staff.cookie, {});
    const undone = (await undo.json()) as { counts: BingoState["counts"] };
    expect(await stored()).toMatchObject({ card_count: 3, bingo_count: undone.counts.bingo, reach_count: undone.counts.reach, bingo_by_seq: "[]" });
    expect((await read<BingoState>(`/events/${eventId}/bingo`, member.cookie)).me).toEqual({ bingo: false, reach: true, rank: null });
  });

  it("reset clears the stored counts with the cards", async () => {
    const { staff, member, eventId } = await setup();
    expect((await json("POST", `/events/${eventId}/bingo`, staff.cookie, {})).status).toBe(201);
    expect((await json("POST", `/events/${eventId}/bingo/card`, member.cookie, {})).status).toBe(200);
    expect((await json("POST", `/events/${eventId}/bingo/start`, staff.cookie, {})).status).toBe(200);
    expect((await json("POST", `/events/${eventId}/bingo/draw`, staff.cookie, {})).status).toBe(200);
    expect((await json("POST", `/events/${eventId}/bingo/end`, staff.cookie, {})).status).toBe(200);
    expect((await json("POST", `/events/${eventId}/bingo/reset`, staff.cookie, {})).status).toBe(200);
    expect((await read<BingoState>(`/events/${eventId}/bingo`, member.cookie)).counts).toEqual({ cards: 0, bingo: 0, reach: 0 });
    expect(await sql("SELECT bingo_by_seq FROM event_bingo_game WHERE event_id=?", eventId).first()).toEqual({ bingo_by_seq: "[]" });
  });
});
