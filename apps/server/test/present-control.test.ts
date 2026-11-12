import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Event, EventState } from "@eventer/shared";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

/** 発表のページめくり（docs/contest-organizer-ux.md「発表のページめくり」）。
 * 署名鍵（secret）はその世代でめくれる人にだけ渡り、渡す・戻す・発表が変わるたびに作り直される */

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
async function actor(name: string) {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,global_name,created_at) VALUES(?,?,?,?,?)", id, id, `U-${id.slice(0, 8)}`, name, Date.now()).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}
type Actor = Awaited<ReturnType<typeof actor>>;
const api = (path: string, user: Actor, method = "GET", body?: unknown) => SELF.fetch(`https://example.com/api${path}`, {
  method, headers: { cookie: user.cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relays): Promise<PublishReport> =>
    ({ ok: true, relays: relays.map((url) => ({ url, outcome: "ok" as const })) }));
});
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const host = await actor("運営");
  const created = await api("/events", host, "POST", { title: "チーム戦", venueType: "online", contestMode: true, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
  const { event } = await created.json() as { event: Event };
  expect((await api(`/events/${event.id}`, host, "PATCH", { status: "published" })).status).toBe(200);
  expect((await api(`/events/${event.id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  const team = async (name: string) => (await (await api(`/events/${event.id}/teams`, host, "POST", { name })).json() as { id: string }).id;
  const red = await team("赤チーム"), blue = await team("青チーム");
  const member = async (name: string, teamId: string) => {
    const user = await actor(name);
    expect((await api(`/events/${event.id}/join`, user, "POST", {})).status).toBe(201);
    expect((await api(`/events/${event.id}/teams/${teamId}/join`, user, "POST")).status).toBe(200);
    return user;
  };
  const a = await member("あおい", red), b = await member("ゆい", red), other = await member("はると", blue);
  return { host, eventId: event.id, red, blue, a, b, other };
}
const stateOf = async (eventId: string, user: Actor) => (await (await api(`/events/${eventId}/state`, user)).json()) as EventState;
const control = (eventId: string, host: Actor, body: unknown) => api(`/events/${eventId}/state/present-control`, host, "PATCH", body);

it("秘密鍵は、運営に戻っているときは運営だけ、渡したら発表中のチームのメンバー全員にだけ付く。ほかのチームには公開鍵と宛先だけ", async () => {
  const { host, eventId, red, a, b, other } = await setup();
  expect((await api(`/events/${eventId}/state/presenting`, host, "PATCH", { presentingEntryId: red })).status).toBe(200);

  const staffView = await stateOf(eventId, host);
  expect(staffView.presentControl).toMatchObject({ kind: 21080, control: "staff", deckSlug: null });
  expect(staffView.presentControl!.secret).toMatch(/^[0-9a-f]{64}$/);
  for (const u of [a, b, other]) {
    const pc = (await stateOf(eventId, u)).presentControl!;
    expect(pc.secret).toBeUndefined();
    expect(pc.pubkey).toBe(staffView.presentControl!.pubkey);
    expect(pc.topic).toBe(staffView.presentControl!.topic);
  }

  expect((await control(eventId, host, { control: "presenter" })).status).toBe(200);
  const given = await stateOf(eventId, a);
  expect(given.presentControl!.secret).toMatch(/^[0-9a-f]{64}$/);
  expect((await stateOf(eventId, b)).presentControl!.secret).toBe(given.presentControl!.secret);
  for (const u of [host, other]) expect((await stateOf(eventId, u)).presentControl!.secret).toBeUndefined();
});

it("渡す・戻す・発表の切り替えのたびに世代と鍵が変わる。発表が変わると運営に戻り、選んだスライドも外れる", async () => {
  const { host, eventId, red, blue, a } = await setup();
  await api(`/events/${eventId}/state/presenting`, host, "PATCH", { presentingEntryId: red });
  const v0 = (await stateOf(eventId, host)).presentControl!;

  expect((await control(eventId, host, { control: "presenter", deckUrl: "/d/teamdeck1" })).status).toBe(200);
  const v1 = (await stateOf(eventId, a)).presentControl!;
  expect(v1).toMatchObject({ version: v0.version + 1, control: "presenter", deckSlug: "teamdeck1" });
  expect(v1.pubkey).not.toBe(v0.pubkey);
  expect(v1.topic).not.toBe(v0.topic);

  expect((await control(eventId, host, { control: "staff" })).status).toBe(200);
  const v2 = (await stateOf(eventId, host)).presentControl!;
  expect(v2.version).toBe(v1.version + 1);
  expect(v2.pubkey).not.toBe(v1.pubkey);
  expect((await stateOf(eventId, a)).presentControl!.secret).toBeUndefined();

  // 同じエントリーを選び直しても変えない。別のエントリーにすると運営に戻り、スライドも外れる
  await control(eventId, host, { control: "presenter" });
  const before = (await stateOf(eventId, host)).presentControl!;
  await api(`/events/${eventId}/state/presenting`, host, "PATCH", { presentingEntryId: red });
  expect((await stateOf(eventId, host)).presentControl!.version).toBe(before.version);
  await api(`/events/${eventId}/state/presenting`, host, "PATCH", { presentingEntryId: blue });
  const next = (await stateOf(eventId, host)).presentControl!;
  expect(next).toMatchObject({ version: before.version + 1, control: "staff", deckSlug: null });
  expect(next.secret).toMatch(/^[0-9a-f]{64}$/);
  expect(next.pubkey).not.toBe(before.pubkey);
});

it("スライドに選べるのは events lab の /d/… だけ。外部URLは 400。運営以外は操作できない", async () => {
  const { host, eventId, red, a } = await setup();
  await api(`/events/${eventId}/state/presenting`, host, "PATCH", { presentingEntryId: red });
  expect((await control(eventId, host, { deckUrl: "https://docs.google.com/presentation/d/xyz" })).status).toBe(400);
  expect((await control(eventId, host, { deckUrl: "https://evil.example/d/abc" })).status).toBe(400);
  expect((await control(eventId, host, { deckUrl: "https://example.com/d/abc?x=1" })).status).toBe(200);
  expect((await stateOf(eventId, host)).presentControl!.deckSlug).toBe("abc");
  expect((await control(eventId, a, { control: "presenter" })).status).toBe(403);
});
