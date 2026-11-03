import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Deck, DeckSummary, Entry, Event } from "@eventer/shared";
import { bindEnv, type Env } from "../src/runtime.js";
import { accountDeletionRepo } from "../src/db/repositories/accountDeletion.js";
import { accountMergeRepo } from "../src/db/repositories/accountMerge.js";

/** チームのスライド (docs/team-participation.md「チームのスライド」) */

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
const error = async (response: Response) => (await response.json() as { error: string }).error;

async function setup() {
  const host = await actor("運営");
  const created = await api("/events", host, "POST", { title: "チーム戦", venueType: "online", contestMode: true, startsAt: Date.now() + 3600000, endsAt: Date.now() + 7200000 });
  expect(created.status).toBe(201);
  const { event } = await created.json() as { event: Event };
  expect((await api(`/events/${event.id}`, host, "PATCH", { status: "published" })).status).toBe(200);
  expect((await api(`/events/${event.id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  const team = async (name: string) => {
    const r = await api(`/events/${event.id}/teams`, host, "POST", { name });
    expect(r.status).toBe(201);
    return (await r.json() as { id: string }).id;
  };
  const red = await team("赤チーム"), blue = await team("青チーム");
  const member = async (name: string, teamId: string | null) => {
    const user = await actor(name);
    expect((await api(`/events/${event.id}/join`, user, "POST", {})).status).toBe(201);
    if (teamId) expect((await api(`/events/${event.id}/teams/${teamId}/join`, user, "POST")).status).toBe(200);
    return user;
  };
  return { host, id: event.id, red, blue, member };
}
const createDeck = (eventId: string, teamId: string, user: Actor) => api(`/events/${eventId}/teams/${teamId}/deck`, user, "POST");
const getDeck = (deckId: string, user: Actor) => api(`/decks/${deckId}`, user);
const patch = (deckId: string, user: Actor, body: Record<string, unknown>) => api(`/decks/${deckId}`, user, "PATCH", body);
const slides = (text: string) => ({ slides: [{ id: "s1", background: "#ffffff", elements: [{ id: "e1", type: "text", x: 0, y: 0, w: 100, h: 40, rotation: 0, text }] }] });
async function submissionOf(eventId: string, teamId: string, user: Actor) {
  const r = await api(`/events/${eventId}/entries`, user);
  return (await r.json() as { entries: Entry[] }).entries.find((e) => e.id === teamId)!.submission;
}

it("メンバーがチームのスライドを作ると、メンバーみんなが編集でき、成果物のプレゼン資料に公開URLが入る", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい", red), b = await member("ゆい", red);
  const created = await createDeck(id, red, a);
  expect(created.status).toBe(201);
  const { deckId } = await created.json() as { deckId: string };

  const deck = await (await getDeck(deckId, b)).json() as Deck;
  expect(deck).toMatchObject({ title: "赤チーム", revision: 0, team: { entryId: red, eventId: id, name: "赤チーム" } });
  expect((await submissionOf(id, red, a))!.presentationUrl).toBe(`http://localhost/d/${deck.slug}`);

  // 作った人でなくても、チームのメンバーなら保存できる
  const saved = await patch(deckId, b, { content: slides("ゆいが書いた"), baseRevision: 0 });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ revision: 1, lastSavedBy: { id: b.id, name: "ゆい" } });
  // 画像も上げられる
  const img = await api(`/decks/${deckId}/images`, b, "PUT");
  expect(img.status).not.toBe(403);

  // 2回目の作成は作らずに既存を返す（1チーム1つ）
  const again = await createDeck(id, red, b);
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ deckId, created: false });
  expect((await sql("SELECT COUNT(*) n FROM deck WHERE team_entry_id = ?", red).first())!.n).toBe(1);

  // 一覧の「チーム: ○○」
  const team = await (await api("/decks/team", b)).json() as { decks: DeckSummary[] };
  expect(team.decks).toEqual([expect.objectContaining({ id: deckId, team: expect.objectContaining({ name: "赤チーム", eventId: id }) })]);
  // 個人の一覧には出ない（作った人のものでもない）
  const mine = await (await api("/decks/mine", a)).json() as { decks: DeckSummary[] };
  expect(mine.decks.map((d) => d.id)).not.toContain(deckId);
});

it("成果物のプレゼン資料URLがすでにあれば上書きしない", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい", red);
  expect((await api(`/events/${id}/entries/${red}/submission`, a, "PUT", { presentationUrl: "https://example.org/slides", sourceCodeUrl: "" })).status).toBe(200);
  expect((await createDeck(id, red, a)).status).toBe(201);
  expect((await submissionOf(id, red, a))!.presentationUrl).toBe("https://example.org/slides");
});

it("ほかのチームの人・チームの外の人・運営は編集できない。運営は一覧で見るだけ", async () => {
  const { host, id, red, blue, member } = await setup();
  const a = await member("あおい", red), other = await member("はると", blue), loner = await member("そら", null);
  const outsider = await actor("外の人");
  const { deckId } = await (await createDeck(id, red, a)).json() as { deckId: string };
  for (const user of [other, loner, outsider, host]) {
    expect((await getDeck(deckId, user)).status).toBe(403);
    expect((await patch(deckId, user, { title: "乗っ取り" })).status).toBe(403);
    expect((await api(`/decks/${deckId}/images`, user, "PUT")).status).toBe(403);
  }
  // ほかのチームのスライドは作れない
  const foreign = await createDeck(id, red, other);
  expect(foreign.status).toBe(403);
  expect(await error(foreign)).toBe("not_this_team_member");
  // 作った人（＝owner_id）でも消せない（チームの作業を1人で消さない）。ほかのメンバーも同じ
  const del = await api(`/decks/${deckId}`, a, "DELETE");
  expect(del.status).toBe(409);
  expect(await error(del)).toBe("team_deck_delete");
  expect((await sql("SELECT COUNT(*) n FROM deck WHERE id = ?", deckId).first())!.n).toBe(1);
  // 運営は全チームの一覧を見られる（編集はできない）
  const staffList = await (await api(`/events/${id}/team-decks`, host)).json() as { decks: { entryId: string; canEdit: boolean }[] };
  expect(staffList.decks).toEqual([expect.objectContaining({ entryId: red, canEdit: false })]);
  // 参加者には自分のチームの分だけ
  expect((await (await api(`/events/${id}/team-decks`, other)).json() as { decks: unknown[] }).decks).toEqual([]);
  expect((await (await api(`/events/${id}/team-decks`, a)).json() as { decks: { canEdit: boolean }[] }).decks).toEqual([expect.objectContaining({ canEdit: true })]);
});

it("チームを抜けると編集できなくなり、入った人は編集できる。チーム参加をオフにすると誰も編集できない", async () => {
  const { host, id, red, blue, member } = await setup();
  const a = await member("あおい", red), b = await member("ゆい", red), c = await member("はると", blue);
  const { deckId } = await (await createDeck(id, red, a)).json() as { deckId: string };
  // 作った人が抜けると、作った人でも編集できない
  expect((await api(`/events/${id}/my-team`, a, "DELETE")).status).toBe(200);
  expect((await patch(deckId, a, { title: "抜けた後" })).status).toBe(403);
  expect((await patch(deckId, b, { title: "残った人" })).status).toBe(200);
  // 新しく入った人は編集できる
  expect((await api(`/events/${id}/teams/${red}/join`, c, "POST")).status).toBe(200);
  expect((await patch(deckId, c, { title: "入った人" })).status).toBe(200);
  // チーム参加をオフ（点数・成果物が無いうちだけ切り替えられる）。成果物にURLが入っているので、
  // 先に消してから切り替える
  await sql("DELETE FROM submission WHERE entry_id = ?", red).run();
  expect((await api(`/events/${id}/team-mode`, host, "PUT", { enabled: false })).status).toBe(200);
  expect((await patch(deckId, b, { title: "オフ" })).status).toBe(403);
  // オンに戻せば元どおり
  expect((await api(`/events/${id}/team-mode`, host, "PUT", { enabled: true })).status).toBe(200);
  expect((await patch(deckId, b, { title: "戻った" })).status).toBe(200);
});

it("同じ版から2人が保存すると、あとの人は 409 で止まり、誰がいつ保存したかが返る", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい", red), b = await member("ゆい", red);
  const { deckId } = await (await createDeck(id, red, a)).json() as { deckId: string };
  expect((await patch(deckId, a, { content: slides("あおい"), baseRevision: 0 })).status).toBe(200);
  const stale = await patch(deckId, b, { content: slides("ゆい"), baseRevision: 0 });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: "deck_conflict", revision: 1, lastSavedBy: { id: a.id, name: "あおい" } });
  // 上書きされていない
  const now = await (await getDeck(deckId, b)).json() as Deck;
  expect(JSON.stringify(now.content)).toContain("あおい");
  // 最新の版を添えれば保存できる
  expect((await patch(deckId, b, { content: slides("ゆい"), baseRevision: 1 })).status).toBe(200);
});

it("個人のデッキも版で守られ、版を添えない保存は今までどおり通る", async () => {
  const u = await actor("ひとり");
  const deck = await (await api("/decks", u, "POST", { title: "個人" })).json() as Deck;
  expect(deck.revision).toBe(0);
  expect((await patch(deck.id, u, { title: "版なし" })).status).toBe(200);
  expect((await patch(deck.id, u, { title: "古い版", baseRevision: 0 })).status).toBe(409);
  expect((await patch(deck.id, u, { title: "新しい版", baseRevision: 1 })).status).toBe(200);
  // 持ち主以外は今までどおり 403
  expect((await patch(deck.id, await actor(), { title: "x" })).status).toBe(403);
});

it("作った人が退会しても、チームのスライドは残ってメンバーが編集できる。統合では最後に保存した人が移る", async () => {
  const { id, red, member } = await setup();
  const a = await member("あおい", red), b = await member("ゆい", red);
  const { deckId } = await (await createDeck(id, red, a)).json() as { deckId: string };
  expect((await patch(deckId, b, { title: "ゆい", baseRevision: 0 })).status).toBe(200);
  // 個人のデッキは退会で消える
  const personal = await (await api("/decks", a, "POST", { title: "あおいの個人" })).json() as Deck;

  bindEnv(env as unknown as Env);
  const ghost = await accountDeletionRepo.ensureDeletedUser();
  await accountDeletionRepo.deleteAccount(a.id, ghost.id);
  expect((await sql("SELECT owner_id FROM deck WHERE id = ?", deckId).first())!.owner_id).toBe(ghost.id);
  expect((await sql("SELECT COUNT(*) n FROM deck WHERE id = ?", personal.id).first())!.n).toBe(0);
  expect((await patch(deckId, b, { title: "残った", baseRevision: 1 })).status).toBe(200);

  // 統合: 最後に保存した人（b）が負け側なら、勝ち側へ移る
  const winner = await actor("勝ち側");
  await accountMergeRepo.mergeUsers(winner.id, b.id);
  expect((await sql("SELECT last_saved_by FROM deck WHERE id = ?", deckId).first())!.last_saved_by).toBe(winner.id);
});

it("チーム参加でないイベント・チームの外ではスライドを作れない", async () => {
  const { host, id, red, member } = await setup();
  const loner = await member("そら", null);
  expect((await createDeck(id, red, loner)).status).toBe(403);
  expect((await createDeck(id, red, host)).status).toBe(403);
  await sql("UPDATE event SET participation_type = 'individual' WHERE id = ?", id).run();
  const a = await member("あおい", null);
  await sql("INSERT INTO entry_member(id,entry_id,user_id,is_leader) VALUES(?,?,?,0)", crypto.randomUUID(), red, a.id).run();
  const off = await createDeck(id, red, a);
  expect(off.status).toBe(409);
  expect(await error(off)).toBe("team_mode_off");
});
