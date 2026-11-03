import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Deck } from "@eventer/shared";

/**
 * 並びの位置キー pos (docs/team-deck-live-sync.md §5.2)。
 * 保存の検証で黙って落とさずにそのまま保存し、公開の閲覧でも返す。形が違えば 400。
 */

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args);
async function actor() {
  const id = crypto.randomUUID(), session = crypto.randomUUID();
  await sql("INSERT INTO user(id,discord_id,username,created_at) VALUES(?,?,?,?)", id, id, `User-${id.slice(0, 8)}`, Date.now()).run();
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", session, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${session}` };
}
const api = (path: string, cookie: string, method = "GET", body?: unknown) => SELF.fetch(`https://example.com/api${path}`, {
  method, headers: { cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const el = (id: string, pos: string) => ({ id, type: "text", x: 0, y: 0, w: 100, h: 40, rotation: 0, text: id, pos });

it("保存した pos は、編集用の取得と公開の閲覧でそのまま返る", async () => {
  const u = await actor();
  const deck = await (await api("/decks", u.cookie, "POST", { title: "並び" })).json() as Deck;
  const content = { slides: [
    { id: "s1", background: "#ffffff", pos: "V", elements: [el("a", "c"), el("b", "m")] },
    { id: "s2", background: "#000000", pos: "k", elements: [] },
  ] };
  expect((await api(`/decks/${deck.id}`, u.cookie, "PATCH", { content })).status).toBe(200);
  const edit = await (await api(`/decks/${deck.id}`, u.cookie)).json() as Deck;
  expect(edit.content.slides.map((s) => s.pos)).toEqual(["V", "k"]);
  expect(edit.content.slides[0].elements.map((e) => e.pos)).toEqual(["c", "m"]);
  const pub = await (await SELF.fetch(`https://example.com/api/public/decks/${deck.slug}`)).json() as Deck;
  expect(pub.content.slides[0].pos).toBe("V");
  expect(pub.content.slides[0].elements.map((e) => e.pos)).toEqual(["c", "m"]);
});

it("pos を持たない中身も今までどおり保存できる", async () => {
  const u = await actor();
  const deck = await (await api("/decks", u.cookie, "POST", { title: "古い形" })).json() as Deck;
  const content = { slides: [{ id: "s1", background: "#ffffff", elements: [{ id: "a", type: "text", x: 0, y: 0, w: 1, h: 1, rotation: 0 }] }] };
  expect((await api(`/decks/${deck.id}`, u.cookie, "PATCH", { content })).status).toBe(200);
});

it("形の違う pos（使えない文字・33 字以上）は 400", async () => {
  const u = await actor();
  const deck = await (await api("/decks", u.cookie, "POST", { title: "不正" })).json() as Deck;
  for (const pos of ["a-b", "a".repeat(33), ""]) {
    const content = { slides: [{ id: "s1", background: "#ffffff", elements: [el("a", pos)] }] };
    expect((await api(`/decks/${deck.id}`, u.cookie, "PATCH", { content })).status).toBe(400);
    const slideContent = { slides: [{ id: "s1", background: "#ffffff", pos, elements: [] }] };
    expect((await api(`/decks/${deck.id}`, u.cookie, "PATCH", { content: slideContent })).status).toBe(400);
  }
});
