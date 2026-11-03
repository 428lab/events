import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeckForEdit, Event } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";
import { deckSyncTopic, DECK_LIVE_SYNC_KEY } from "../src/lib/deckSync.js";
import { eventSignal } from "../src/lib/eventSignal.js";
import { nostrRelay } from "../src/lib/nostrRelay.js";
import type { PublishReport } from "../src/lib/nostrRelay.js";

/** チームのスライドの同時編集・サーバー側（docs/team-deck-live-sync.md §4）。
 * 鍵は今のメンバーにだけ渡り、編集できる人が減りうるたびに作り直される */

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
async function actor(name = "") {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,global_name,created_at) VALUES(?,?,?,?,?)", id, id, `User-${id.slice(0, 8)}`, name || null, Date.now()).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}
type Actor = Awaited<ReturnType<typeof actor>>;
const api = (path: string, user: Actor, method = "GET", body?: unknown) => SELF.fetch(`https://example.com/api${path}`, {
  method, headers: { cookie: user.cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

let published: string[][] = [];
beforeEach(async () => {
  await sql("INSERT INTO app_setting(key,value,updated_at) VALUES(?, '1', 1) ON CONFLICT(key) DO UPDATE SET value='1'", DECK_LIVE_SYNC_KEY).run();
  published = [];
  vi.spyOn(nostrRelay, "publishToRelays").mockImplementation(async (relays, signal): Promise<PublishReport> => {
    published.push(signal.tags.filter((t) => t[0] === "t").map((t) => t[1]!));
    return { ok: true, relays: relays.map((url) => ({ url, outcome: "ok" as const })) };
  });
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
  const member = async (name: string, teamId: string | null) => {
    const user = await actor(name);
    expect((await api(`/events/${event.id}/join`, user, "POST", {})).status).toBe(201);
    if (teamId) expect((await api(`/events/${event.id}/teams/${teamId}/join`, user, "POST")).status).toBe(200);
    return user;
  };
  const a = await member("あおい", red), b = await member("ゆい", red);
  const { deckId } = await (await api(`/events/${event.id}/teams/${red}/deck`, a, "POST")).json() as { deckId: string };
  return { host, eventId: event.id, red, blue, a, b, deckId, member };
}
const get = async (deckId: string, user: Actor) => {
  const r = await api(`/decks/${deckId}`, user);
  return { status: r.status, body: r.status === 200 ? await r.json() as DeckForEdit : null };
};
const syncOf = async (deckId: string, user: Actor) => (await get(deckId, user)).body!.sync!;
const keyRow = (deckId: string) => sql("SELECT version, secret FROM deck_sync_key WHERE deck_id = ?", deckId).first<{ version: number; secret: string }>();

it("今のメンバーにだけ鍵と宛先が渡る。外の人・運営・公開の閲覧・個人のデッキ・機能オフでは出ない", async () => {
  const { host, eventId, blue, a, b, deckId, member } = await setup();
  const mine = await syncOf(deckId, a);
  expect(mine).toMatchObject({ kind: 21078, key: { version: 1 }, me: { userId: a.id, name: "あおい" }, topic: deckSyncTopic(deckId, 1) });
  expect(mine.key.secret).toMatch(/^[0-9a-f]{64}$/);
  expect(mine.signal).toMatchObject({ topic: eventSignal.config(deckId, "deck-sync", 1)!.topic });
  // 同じチームのもう1人は同じ世代の同じ鍵
  expect((await syncOf(deckId, b)).key).toEqual(mine.key);

  const other = await member("はると", blue);
  for (const user of [other, host, await actor("外の人")]) expect((await get(deckId, user)).status).toBe(403);
  const { slug } = (await get(deckId, a)).body!;
  const pub = await (await SELF.fetch(`https://example.com/api/public/decks/${slug}`)).text();
  expect(pub).not.toContain(mine.key.secret);
  expect(pub).not.toContain(mine.topic);
  const staffList = await (await api(`/events/${eventId}/team-decks`, host)).text();
  expect(staffList).not.toContain(mine.key.secret);

  const personal = await (await api("/decks", a, "POST", { title: "個人" })).json() as { id: string };
  expect((await get(personal.id, a)).body!.sync).toBeNull();

  await sql("UPDATE app_setting SET value = '0' WHERE key = ?", DECK_LIVE_SYNC_KEY).run();
  expect((await get(deckId, a)).body!.sync).toBeNull();
});

it("入っただけでは作り直さない。保存の応答に今の世代が出る", async () => {
  const { eventId, red, a, deckId, member } = await setup();
  const before = await syncOf(deckId, a);
  const c = await member("はると", null);
  expect((await api(`/events/${eventId}/teams/${red}/join`, c, "POST")).status).toBe(200);
  expect((await syncOf(deckId, c)).key).toEqual(before.key);

  const saved = await api(`/decks/${deckId}`, a, "PATCH", { title: "x", baseRevision: 0 });
  expect(await saved.json()).toMatchObject({ syncVersion: 1 });
  const stale = await api(`/decks/${deckId}`, c, "PATCH", { title: "y", baseRevision: 0 });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: "deck_conflict", syncVersion: 1 });
});

/** 編集できる人が減る経路それぞれで、残ったメンバーの次の GET は新しい世代・新しい鍵・新しい宛先になり、
 * 外れた人には鍵が渡らない。`deck-sync` の合図も出る */
const removals: Array<[string, (s: Awaited<ReturnType<typeof setup>>) => Promise<void>]> = [
  ["チームを抜ける", async ({ eventId, a }) => {
    expect((await api(`/events/${eventId}/my-team`, a, "DELETE")).status).toBe(200);
  }],
  ["別のチームへ移る", async ({ eventId, blue, a }) => {
    expect((await api(`/events/${eventId}/teams/${blue}/join`, a, "POST")).status).toBe(200);
  }],
  ["運営がチームから外す", async ({ host, eventId, a }) => {
    expect((await api(`/events/${eventId}/team-members/${a.id}`, host, "PUT", { teamId: null })).status).toBe(200);
  }],
  ["参加を取り消す（0115 のトリガー経由）", async ({ eventId, a }) => {
    expect((await api(`/events/${eventId}/join`, a, "DELETE")).status).toBe(200);
  }],
  ["参加者からスタッフにする（0115 のトリガー経由）", async ({ host, eventId, a }) => {
    expect((await api(`/events/${eventId}/members/${a.id}/role`, host, "PATCH", { role: "staff" })).status).toBe(200);
  }],
  ["退会を申請する（行は残る）", async ({ a }) => {
    expect((await api("/me", a, "DELETE", { confirm: true })).status).toBe(200);
  }],
];
it.each(removals)("%s → 鍵が作り直され、外れた人には渡らない", async (_name, remove) => {
  const s = await setup();
  const before = await syncOf(s.deckId, s.a);
  published = [];
  await remove(s);
  expect((await keyRow(s.deckId))!.version).toBe(2);
  const after = await syncOf(s.deckId, s.b);
  expect(after.key.version).toBe(2);
  expect(after.key.secret).not.toBe(before.key.secret);
  expect(after.topic).not.toBe(before.topic);
  expect((await get(s.deckId, s.a)).status).not.toBe(200);
  expect(published.flat()).toContain(eventSignal.config(s.deckId, "deck-sync", 1)!.topic);
});

it("チーム参加をオフ・コンテスト形式をオフにすると、誰も編集できなくなるので作り直す", async () => {
  const s = await setup();
  await syncOf(s.deckId, s.a);
  await sql("DELETE FROM submission WHERE entry_id = ?", s.red).run();
  expect((await api(`/events/${s.eventId}/team-mode`, s.host, "PUT", { enabled: false })).status).toBe(200);
  expect((await keyRow(s.deckId))!.version).toBe(2);
  expect((await api(`/events/${s.eventId}/team-mode`, s.host, "PUT", { enabled: true })).status).toBe(200);
  expect((await keyRow(s.deckId))!.version).toBe(2); // オンでは作り直さない

  expect((await api(`/events/${s.eventId}`, s.host, "PATCH", { contestMode: false })).status).toBe(200);
  expect((await keyRow(s.deckId))!.version).toBe(3);
  expect((await get(s.deckId, s.a)).status).toBe(403);
  // コンテスト形式に関係ない変更では作り直さない
  expect((await api(`/events/${s.eventId}`, s.host, "PATCH", { contestMode: true })).status).toBe(200);
  expect((await api(`/events/${s.eventId}`, s.host, "PATCH", { title: "名前だけ" })).status).toBe(200);
  expect((await keyRow(s.deckId))!.version).toBe(4);
});

it("イベントが終わったらチームのスライドは編集できず、鍵も渡らない。日程調整中は終わっていない", async () => {
  const s = await setup();
  const now = Date.now();
  await sql("UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?", now - 7200000, now - 3600000, s.eventId).run();
  expect((await api(`/decks/${s.deckId}`, s.a, "PATCH", { title: "終わったあと" })).status).toBe(403);
  expect((await get(s.deckId, s.a)).status).toBe(403);
  bindEnv(env as unknown as Env);
  const { decksRepo } = await import("../src/db/repositories/decks.js");
  expect(await decksRepo.syncKeyForEdit(s.deckId, s.a.id)).toBeNull();
  expect(await keyRow(s.deckId)).toBeNull();
  // 日程調整中（過去の仮の日時が入っていても）は終わっていない
  await sql("UPDATE event SET scheduling = 1 WHERE id = ?", s.eventId).run();
  expect((await api(`/decks/${s.deckId}`, s.a, "PATCH", { title: "調整中" })).status).toBe(200);
  expect((await syncOf(s.deckId, s.a)).key.version).toBe(1);
});

it("鍵は編集できる人の文の中でだけ作られ・読まれる（外れたあとに初めて GET しても鍵は作られず渡らない）", async () => {
  const s = await setup();
  // まだ誰も GET していない（鍵の行が無い）うちに a が抜ける
  expect((await api(`/events/${s.eventId}/my-team`, s.a, "DELETE")).status).toBe(200);
  bindEnv(env as unknown as Env);
  const { decksRepo } = await import("../src/db/repositories/decks.js");
  expect(await decksRepo.syncKeyForEdit(s.deckId, s.a.id)).toBeNull();
  expect(await keyRow(s.deckId)).toBeNull();
  // 退会申請中のメンバーも同じ（行は残るが編集判定を通らない）
  await accountDeletionRepo.requestDeletion(s.b.id, Date.now());
  expect(await decksRepo.syncKeyForEdit(s.deckId, s.b.id)).toBeNull();
  expect(await keyRow(s.deckId)).toBeNull();
});
