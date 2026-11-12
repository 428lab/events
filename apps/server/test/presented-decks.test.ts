import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Event, PresentedDecksResponse } from "@eventer/shared";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

/** イベントページの「発表スライド」（docs/contest-organizer-ux.md「発表スライドをイベントページに出す」）。
 * 発表が終わるまで（イベントが終わる・集計/表彰に進むまで）は運営だけに見せ、参加者には出さない */

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
const presented = async (eventId: string, user: Actor) =>
  (await (await api(`/events/${eventId}/presented-decks`, user)).json()) as PresentedDecksResponse;

beforeEach(() => {
  vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relays): Promise<PublishReport> =>
    ({ ok: true, relays: relays.map((url) => ({ url, outcome: "ok" as const })) }));
});
afterEach(() => vi.restoreAllMocks());

/** チーム戦: 赤はチームのスライド（3枚）、青は外部URL */
async function teamContest() {
  const host = await actor("運営");
  const created = await api("/events", host, "POST", { title: "チーム戦", venueType: "offline", contestMode: true, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
  const { event } = await created.json() as { event: Event };
  expect((await api(`/events/${event.id}`, host, "PATCH", { status: "published" })).status).toBe(200);
  expect((await api(`/events/${event.id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  const team = async (name: string) => (await (await api(`/events/${event.id}/teams`, host, "POST", { name })).json() as { id: string }).id;
  const red = await team("赤チーム"), blue = await team("青チーム");
  const join = async (name: string, teamId: string) => {
    const user = await actor(name);
    expect((await api(`/events/${event.id}/join`, user, "POST", {})).status).toBe(201);
    expect((await api(`/events/${event.id}/teams/${teamId}/join`, user, "POST")).status).toBe(200);
    return user;
  };
  const a = await join("あおい", red), b = await join("はると", blue);
  const made = await (await api(`/events/${event.id}/teams/${red}/deck`, a, "POST")).json() as { deckId: string };
  const slides = [1, 2, 3].map((n) => ({ id: `s${n}`, background: "#000000", elements: [] }));
  await sql("UPDATE deck SET content = ? WHERE id = ?", JSON.stringify({ slides }), made.deckId).run();
  // 青は外部サイトの URL。末尾が赤のスライドと同じ slug でも、events lab のスライドとは扱わない
  const redSlug = (await sql("SELECT slug FROM deck WHERE id = ?", made.deckId).first<{ slug: string }>())!.slug;
  expect((await api(`/events/${event.id}/entries/${blue}/submission`, b, "PUT", { presentationUrl: `https://slides.example.net/d/${redSlug}` })).status).toBe(200);
  return { host, eventId: event.id, red, a, b };
}

it("発表が終わるまでは参加者には出さず、運営には「まだ運営だけ」と分かる形で出す。集計に進むか、イベントが終わると参加者にも出る", async () => {
  const { host, eventId, a } = await teamContest();
  expect(await presented(eventId, a)).toEqual({ decks: [], staffPreview: false });
  const staffView = await presented(eventId, host);
  expect(staffView.staffPreview).toBe(true);
  expect(staffView.decks.map((d) => d.entryName)).toEqual(["赤チーム"]);

  expect((await api(`/events/${eventId}/state/mode`, host, "PATCH", { mode: "aggregation" })).status).toBe(200);
  expect((await presented(eventId, a)).decks).toHaveLength(1);

  await api(`/events/${eventId}/state/mode`, host, "PATCH", { mode: "presentation" });
  expect((await presented(eventId, a)).decks).toHaveLength(0);
  await sql("UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?", Date.now() - 7200000, Date.now() - 60000, eventId).run();
  const after = await presented(eventId, a);
  expect(after.staffPreview).toBe(false);
  expect(after.decks).toHaveLength(1);
});

it("出すのは events lab のスライドに結び付いたエントリーだけ（チームも個人も）。外部URLは出さず、サムネ用に1枚目だけを返す", async () => {
  const { eventId, host, red } = await teamContest();
  await sql("UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?", Date.now() - 7200000, Date.now() - 60000, eventId).run();
  const { decks } = await presented(eventId, host);
  expect(decks).toHaveLength(1);
  expect(decks[0]).toMatchObject({ entryId: red, entryName: "赤チーム", kind: "team", deck: { slideCount: 3, firstSlide: { id: "s1" } } });
  expect(JSON.stringify(decks[0])).not.toContain("\"s2\"");

  // 個人参加のコンテストでも同じ（自分のスライドの /d/:slug を成果物に貼った人）
  const solo = await actor("ひとり");
  const created = await api("/events", host, "POST", { title: "個人戦", venueType: "online", contestMode: true, startsAt: Date.now() - 7200000, endsAt: Date.now() - 60000 });
  const { event } = await created.json() as { event: Event };
  await api(`/events/${event.id}`, host, "PATCH", { status: "published" });
  await sql("INSERT INTO event_member(id,event_id,user_id,role,status,created_at) VALUES(?,?,?,?,?,?)", crypto.randomUUID(), event.id, solo.id, "participant", "confirmed", Date.now()).run();
  const entryId = crypto.randomUUID();
  await sql("INSERT INTO entry(id,event_id,kind,name,created_at) VALUES(?,?,?,?,?)", entryId, event.id, "individual", "ひとり", Date.now()).run();
  await sql("INSERT INTO entry_member(id,entry_id,user_id,is_leader) VALUES(?,?,?,0)", crypto.randomUUID(), entryId, solo.id).run();
  const deck = await (await api("/decks", solo, "POST", { title: "ひとりの発表" })).json() as { slug: string };
  expect((await api(`/events/${event.id}/entries/${entryId}/submission`, solo, "PUT", { presentationUrl: `https://example.com/d/${deck.slug}` })).status).toBe(200);
  const soloView = await presented(event.id, solo);
  expect(soloView.decks).toMatchObject([{ entryId, kind: "individual", deck: { slug: deck.slug, title: "ひとりの発表" } }]);
});
