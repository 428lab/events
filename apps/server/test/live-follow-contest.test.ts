import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Deck, Event, EventLiveStateWithCutin } from "@eventer/shared";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

/** 配信をコンテストの発表に連動させる（docs/contest-organizer-ux.md「配信との連動」）。
 * 連動中の配信のスライドは発表中のエントリーのもの、ページめくりの宛先は秘密鍵なしで配信に渡る */

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
  const a = await member("あおい", red), b = await member("はると", blue);
  // チームのスライドを作ると成果物の資料URLに /d/:slug が入る
  const deckOf = async (user: Actor, teamId: string) =>
    (await (await api(`/events/${event.id}/teams/${teamId}/deck`, user, "POST")).json() as { deckId: string }).deckId;
  const redDeck = await deckOf(a, red), blueDeck = await deckOf(b, blue);
  return { host, eventId: event.id, red, blue, a, redDeck, blueDeck };
}
const liveState = async (eventId: string, user: Actor) =>
  (await (await api(`/events/${eventId}/live-state`, user)).json()) as EventLiveStateWithCutin;
const liveDeck = async (eventId: string, user: Actor) =>
  ((await (await api(`/events/${eventId}/live-deck-content`, user)).json()) as { deck: Deck | null }).deck;
const presenting = (eventId: string, host: Actor, entryId: string) =>
  api(`/events/${eventId}/state/presenting`, host, "PATCH", { presentingEntryId: entryId });

it("連動中の配信は発表中のチームのスライドを出し、発表が変わるとスライドが変わってページが 1 ページ目に戻る。連動を切ると元の選択", async () => {
  const { host, eventId, red, blue, redDeck, blueDeck } = await setup();
  expect((await presenting(eventId, host, red)).status).toBe(200);
  expect(await liveDeck(eventId, host)).toBeNull();

  expect((await api(`/events/${eventId}/live-state`, host, "PATCH", { followContest: true })).status).toBe(200);
  expect((await liveDeck(eventId, host))!.id).toBe(redDeck);
  const state = await liveState(eventId, host);
  expect(state).toMatchObject({ followContest: true, contest: { entryId: red, entryName: "赤チーム", deckId: redDeck } });

  // 運営が保存したページ（リレーに届かない配信画面の拠り所）は、発表が変わると 1 ページ目に戻る
  expect((await api(`/events/${eventId}/live-state`, host, "PATCH", { deckPage: 2 })).status).toBe(200);
  expect((await presenting(eventId, host, blue)).status).toBe(200);
  expect((await liveDeck(eventId, host))!.id).toBe(blueDeck);
  expect(await liveState(eventId, host)).toMatchObject({ deckPage: 0, contest: { entryId: blue, deckId: blueDeck } });

  expect((await api(`/events/${eventId}/live-state`, host, "PATCH", { followContest: false })).status).toBe(200);
  expect(await liveDeck(eventId, host)).toBeNull();
  expect((await liveState(eventId, host)).contest).toBeNull();
});

it("配信に渡すページめくりの設定は秘密鍵を含まない。運営がめくる世代でも、渡した世代でも", async () => {
  const { host, eventId, red } = await setup();
  await presenting(eventId, host, red);
  await api(`/events/${eventId}/live-state`, host, "PATCH", { followContest: true });

  const staffView = (await (await api(`/events/${eventId}/state`, host)).json()) as { presentControl: { secret?: string; pubkey: string } };
  expect(staffView.presentControl.secret).toMatch(/^[0-9a-f]{64}$/);
  const live = await liveState(eventId, host);
  expect(live.contest!.present).toMatchObject({ kind: 21080, pubkey: staffView.presentControl.pubkey });
  expect(live.contest!.present).not.toHaveProperty("secret");

  await api(`/events/${eventId}/state/present-control`, host, "PATCH", { control: "presenter" });
  const handed = await liveState(eventId, host);
  expect(handed.contest!.present).toMatchObject({ control: "presenter" });
  expect(handed.contest!.present).not.toHaveProperty("secret");
  expect(JSON.stringify(handed)).not.toContain(staffView.presentControl.secret!);
});

it("連動はコンテスト形式のイベントだけ。運営以外は切り替えられない", async () => {
  const { eventId, a } = await setup();
  expect((await api(`/events/${eventId}/live-state`, a, "PATCH", { followContest: true })).status).toBe(403);
  const host = await actor("ふつうの主催");
  const { event } = await (await api("/events", host, "POST", { title: "勉強会", venueType: "online", startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 })).json() as { event: Event };
  expect((await api(`/events/${event.id}/live-state`, host, "PATCH", { followContest: true })).status).toBe(409);
});

it("連動中にコンテスト形式をやめても、連動はオフに戻せ、配信はコンテストのスライドを出さない", async () => {
  const { host, eventId, red } = await setup();
  expect((await presenting(eventId, host, red)).status).toBe(200);
  expect((await api(`/events/${eventId}/live-state`, host, "PATCH", { followContest: true })).status).toBe(200);
  expect(await liveDeck(eventId, host)).not.toBeNull();
  expect((await api(`/events/${eventId}`, host, "PATCH", { contestMode: false })).status).toBe(200);
  // スイッチが残っていても連動しない
  expect(await liveDeck(eventId, host)).toBeNull();
  expect((await liveState(eventId, host)).contest).toBeNull();
  // オフに戻せる（オンにはできない）
  expect((await api(`/events/${eventId}/live-state`, host, "PATCH", { followContest: false })).status).toBe(200);
  expect((await liveState(eventId, host)).followContest).toBe(false);
  expect((await api(`/events/${eventId}/live-state`, host, "PATCH", { followContest: true })).status).toBe(409);
});
