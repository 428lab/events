import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Deck, Event } from "@eventer/shared";
import { deckAgentTokensRepo } from "../src/db/repositories/deckAgentTokens.js";

/** チームのスライドを AI に書いてもらう (docs/agent-deck-token.md「チームのスライド」)。
 * AI が書いている間はメンバーも編集できず、取り消すとまた編集できる */

const BASE = "https://example.com";
const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
async function actor(name: string) {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,global_name,created_at) VALUES(?,?,?,?,?)", id, id, `User-${id.slice(0, 8)}`, name, Date.now()).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}
type Actor = Awaited<ReturnType<typeof actor>>;
const api = (path: string, user: Actor, method = "GET", body?: unknown) => SELF.fetch(`${BASE}/api${path}`, {
  method, headers: { cookie: user.cookie, "content-type": "application/json", origin: BASE },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const error = async (response: Response) => (await response.json() as { error: string }).error;
const agentPut = (token: string, title: string) => SELF.fetch(`${BASE}/api/agent/deck`, {
  method: "PUT",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ format: "events-lab-deck", version: 2, title, slides: [{ background: "#FFFFFF", elements: [
    { type: "text", x: 40, y: 40, w: 880, h: 100, text: title, fontSize: 40, font: "default", color: "#111111", bold: true, italic: false, align: "left" },
  ] }] }),
});

async function setup() {
  const host = await actor("運営");
  const created = await api("/events", host, "POST", { title: "チーム戦", venueType: "online", contestMode: true, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
  const { event } = await created.json() as { event: Event };
  expect((await api(`/events/${event.id}`, host, "PATCH", { status: "published" })).status).toBe(200);
  expect((await api(`/events/${event.id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  const red = (await (await api(`/events/${event.id}/teams`, host, "POST", { name: "赤チーム" })).json() as { id: string }).id;
  const member = async (name: string) => {
    const user = await actor(name);
    expect((await api(`/events/${event.id}/join`, user, "POST", {})).status).toBe(201);
    expect((await api(`/events/${event.id}/teams/${red}/join`, user, "POST")).status).toBe(200);
    return user;
  };
  return { id: event.id, red, member };
}
const issue = (eventId: string, teamId: string, user: Actor) => api(`/events/${eventId}/teams/${teamId}/deck/agent-token`, user, "POST");
const revoke = (eventId: string, teamId: string, user: Actor) => api(`/events/${eventId}/teams/${teamId}/deck/agent-token`, user, "DELETE");

it("メンバーが発行するとスライドが無くても作られ、AI が書くとチームのスライドの版が進む。書いている間はメンバーも編集できず、取り消すと編集できる", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい"), b = await member("ゆい");
  const issued = await issue(id, red, a);
  expect(issued.status).toBe(201);
  const { token, deckId } = await issued.json() as { token: string; deckId: string };
  expect((await sql("SELECT team_entry_id FROM deck WHERE id = ?", deckId).first())!.team_entry_id).toBe(red);
  // 個人の「有効なトークン」一覧（/decks/import）には混ざらない
  expect((await (await api("/decks/agent-tokens", a)).json() as { tokens: unknown[] }).tokens).toEqual([]);

  const written = await agentPut(token, "AIの土台");
  expect(written.status).toBe(200);
  expect(await written.json()).toMatchObject({ created: false, id: deckId });
  expect(await sql("SELECT title, revision, last_saved_by FROM deck WHERE id = ?", deckId).first())
    .toEqual({ title: "AIの土台", revision: 1, last_saved_by: a.id });

  // 書いている間: 編集用の取得・保存・画像は 423、同時編集の鍵も渡らない。一覧には誰がいつまでか
  for (const user of [a, b]) {
    const got = await api(`/decks/${deckId}`, user);
    expect(got.status).toBe(423);
    expect(await got.json()).toMatchObject({ error: "agent_writing", agent: { issuedBy: { name: "あおい" } } });
    expect((await api(`/decks/${deckId}`, user, "PATCH", { title: "横から" })).status).toBe(423);
    expect((await api(`/decks/${deckId}/images`, user, "PUT")).status).toBe(423);
  }
  expect((await sql("SELECT COUNT(*) n FROM deck_sync_key WHERE deck_id = ?", deckId).first())!.n).toBe(0);
  const listed = await (await api(`/events/${id}/team-decks`, b)).json() as { decks: { canEdit: boolean; agent: unknown }[] };
  expect(listed.decks).toEqual([expect.objectContaining({ canEdit: false, agent: expect.objectContaining({ issuedBy: { name: "あおい" } }) })]);

  // 発行していないメンバーでも取り消せる。取り消すと AI は書けず、メンバーは AI の中身を編集できる
  expect((await revoke(id, red, b)).status).toBe(200);
  expect((await agentPut(token, "取り消し後")).status).toBe(401);
  const deck = await (await api(`/decks/${deckId}`, b)).json() as Deck;
  expect(deck).toMatchObject({ title: "AIの土台", revision: 1 });
  expect((await api(`/decks/${deckId}`, b, "PATCH", { title: "ゆいが直した", baseRevision: 1 })).status).toBe(200);
});

it("有効なトークンがあれば2本目は 409 agent_busy。期限が切れたらまた編集でき、発行もできる", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい"), b = await member("ゆい");
  const first = await issue(id, red, a);
  expect(first.status).toBe(201);
  const { deckId } = await first.json() as { deckId: string };
  const second = await issue(id, red, b);
  expect(second.status).toBe(409);
  expect(await second.json()).toMatchObject({ error: "agent_busy", agent: { issuedBy: { name: "あおい" } } });

  // 期限切れ（取り消しの操作が無くても、次の取得で編集できる）
  await sql("UPDATE deck_agent_token SET expires_at = ? WHERE team_deck_id = ?", Date.now() - 1, deckId).run();
  expect((await api(`/decks/${deckId}`, b)).status).toBe(200);
  expect((await issue(id, red, b)).status).toBe(201);
});

it("発行した人がチームを抜けると、そのトークンは取り消されて AI は書けない", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい"), b = await member("ゆい");
  const { token, deckId } = await (await issue(id, red, a)).json() as { token: string; deckId: string };
  expect((await api(`/events/${id}/my-team`, a, "DELETE")).status).toBe(200);
  expect((await agentPut(token, "抜けた人のAI")).status).toBe(401);
  // 残ったメンバーはすぐ編集できる
  expect((await api(`/decks/${deckId}`, b)).status).toBe(200);
});

it("終わったイベントでは発行できない（event_ended）", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい");
  await sql("UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?", Date.now() - 7200000, Date.now() - 3600000, id).run();
  const res = await issue(id, red, a);
  expect(res.status).toBe(409);
  expect(await error(res)).toBe("event_ended");
});

it("認証のあと書き込みまでの間に取り消されたら、AI の書き込みは入らない", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい");
  const { deckId } = await (await issue(id, red, a)).json() as { deckId: string };
  const tokenId = (await sql("SELECT id FROM deck_agent_token WHERE team_deck_id = ?", deckId).first())!.id as string;
  // ミドルウェアの確認は通ったあと（行はもう読んである）に、メンバーが取り消した
  await sql("UPDATE deck_agent_token SET revoked_at = ? WHERE id = ?", Date.now(), tokenId).run();
  const before = await sql("SELECT title, content, revision FROM deck WHERE id = ?", deckId).first();
  const result = await deckAgentTokensRepo.replaceTeamDeck({ tokenId, ownerId: a.id, deckId, title: "遅れて届いた", content: '{"slides":[]}', now: Date.now() });
  expect(result).toBe("revoked");
  expect(await sql("SELECT title, content, revision FROM deck WHERE id = ?", deckId).first()).toEqual(before);
});
