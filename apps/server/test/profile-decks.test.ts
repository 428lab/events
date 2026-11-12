import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeckSummary, Event, ProfileDecksResponse } from "@eventer/shared";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

/** プロフィールの「スライド」タブと表示回数（docs/profile-tabs.md「スライド」・docs/slide-editor.md）。
 * 載せるのは本人が選んだものだけ（オプトイン）。「自動で載せる」をオンにすると、載せないにしたもの以外が載る */

const BASE = "https://example.com";
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
async function actor(name: string) {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  const handle = `u${id.slice(0, 8)}`;
  await sql("INSERT INTO user(id,discord_id,username,global_name,created_at) VALUES(?,?,?,?,?)", id, id, handle, name, Date.now()).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, handle, cookie: `eventer_session=${session}` };
}
type Actor = Awaited<ReturnType<typeof actor>>;
const api = (path: string, user: Actor | null, method = "GET", body?: unknown, extra: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(user ? { cookie: user.cookie } : {}), "content-type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function newDeck(owner: Actor, title: string) {
  const res = await api("/decks", owner, "POST", { title });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; slug: string };
}
const profile = async (handle: string, viewer: Actor | null = null) =>
  (await (await api(`/public/users/${handle}/decks`, viewer)).json()) as ProfileDecksResponse;

beforeEach(() => {
  vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relays): Promise<PublishReport> =>
    ({ ok: true, relays: relays.map((url) => ({ url, outcome: "ok" as const })) }));
});
afterEach(() => vi.restoreAllMocks());

it("載せるのは本人が選んだデッキだけ。公開プロフィールにはサムネ用の1枚目だけを返し、他人のデッキは選べない", async () => {
  const me = await actor("わたし"), other = await actor("ほか");
  const a = await newDeck(me, "見せる"), b = await newDeck(me, "見せない");
  await sql("UPDATE deck SET content = ? WHERE id = ?",
    JSON.stringify({ slides: [{ id: "p1", background: "#000000", elements: [] }, { id: "p2", background: "#000000", elements: [] }] }), a.id).run();
  expect(await profile(me.handle)).toEqual({ decks: [] });

  expect((await api(`/decks/${a.id}/profile`, me, "PUT", { show: true })).status).toBe(200);
  expect((await api(`/decks/${b.id}/profile`, other, "PUT", { show: true })).status).toBe(403);
  const shown = await profile(me.handle);
  expect(shown.decks.map((d) => d.title)).toEqual(["見せる"]);
  expect(shown.decks[0]).toMatchObject({ slug: a.slug, slideCount: 2, firstSlide: { id: "p1" }, views: 0, team: null });
  expect(JSON.stringify(shown)).not.toContain("\"p2\"");
  expect(shown.autoShow).toBeUndefined();
  // 一覧のスイッチの状態
  const mine = (await (await api("/decks/mine", me)).json()) as { decks: DeckSummary[] };
  expect(Object.fromEntries(mine.decks.map((d) => [d.title, d.profileShown]))).toEqual({ "見せる": true, "見せない": false });
});

it("「自動で載せる」をオンにすると、載せないにしたもの以外（これから作るものも）が載る。オフに戻すと選んだものだけ", async () => {
  const me = await actor("わたし");
  const kept = await newDeck(me, "残す"), hidden = await newDeck(me, "隠す");
  expect((await api(`/decks/${hidden.id}/profile`, me, "PUT", { show: false })).status).toBe(200);
  expect((await api("/decks/profile-auto", me, "PUT", { autoShow: true })).status).toBe(200);
  const later = await newDeck(me, "あとから");

  const on = await profile(me.handle, me);
  expect(on.autoShow).toBe(true);
  expect(on.decks.map((d) => d.slug).sort()).toEqual([kept.slug, later.slug].sort());

  expect((await api("/decks/profile-auto", me, "PUT", { autoShow: false })).status).toBe(200);
  expect((await profile(me.handle)).decks).toEqual([]);
});

it("チームのスライドはメンバーなら自分のプロフィールに載せられる（公開イベントのもの）。メンバーでない人は選べない", async () => {
  const host = await actor("運営");
  const created = await api("/events", host, "POST", { title: "チーム戦", venueType: "offline", contestMode: true, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
  const { event } = await created.json() as { event: Event };
  expect((await api(`/events/${event.id}`, host, "PATCH", { status: "published" })).status).toBe(200);
  expect((await api(`/events/${event.id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  const team = (await (await api(`/events/${event.id}/teams`, host, "POST", { name: "ねこ" })).json() as { id: string }).id;
  const member = await actor("あおい"), outsider = await actor("よそ");
  expect((await api(`/events/${event.id}/join`, member, "POST", {})).status).toBe(201);
  expect((await api(`/events/${event.id}/teams/${team}/join`, member, "POST")).status).toBe(200);
  const deckId = (await (await api(`/events/${event.id}/teams/${team}/deck`, member, "POST")).json() as { deckId: string }).deckId;

  expect((await api(`/decks/${deckId}/profile`, outsider, "PUT", { show: true })).status).toBe(403);
  expect((await api(`/decks/${deckId}/profile`, member, "PUT", { show: true })).status).toBe(200);
  expect((await profile(member.handle)).decks[0]).toMatchObject({ team: { name: "ねこ", eventTitle: "チーム戦" } });
});

it("表示回数は同じ訪問者なら1日1回。別の訪問者は数え、持ち主の閲覧は数えない", async () => {
  const me = await actor("わたし"), guest = await actor("ゲスト");
  const d = await newDeck(me, "数える");
  const view = (user: Actor | null, vid: string) =>
    api(`/public/decks/${d.slug}/view`, user, "POST", undefined, { cookie: [user?.cookie, `ev_vid=${vid}`].filter(Boolean).join("; ") });
  expect(await (await view(null, "visitor-a")).json()).toEqual({ views: 1 });
  expect(await (await view(null, "visitor-a")).json()).toEqual({ views: 1 });
  expect(await (await view(guest, "visitor-b")).json()).toEqual({ views: 2 });
  expect(await (await view(me, "visitor-c")).json()).toEqual({ views: 2 });

  expect((await api(`/decks/${d.id}/profile`, me, "PUT", { show: true })).status).toBe(200);
  expect((await profile(me.handle)).decks[0]!.views).toBe(2);
});
