import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { exportDeckV2, type DeckContent } from "@eventer/shared";

/** 作成済みのスライドを AI に直してもらう（docs/agent-deck-token.md §4c。オーナー決定 2026-11-28）。
 * 読ませる・書いている間は持ち主も編集できない・「AIの変更を取り消す」 */
const BASE = "https://example.com";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

async function user() {
  const id = crypto.randomUUID(), sid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, 'test', ?)").bind(id, `test:${id}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, id, Date.now() + 86400000).run();
  return { id, cookie: `eventer_session=${sid}` };
}
const cookieReq = (path: string, cookie: string, method = "GET", body?: unknown) =>
  SELF.fetch(`${BASE}/api${path}`, {
    method,
    headers: { cookie, origin: BASE, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const agentGet = (token: string) => SELF.fetch(`${BASE}/api/agent/deck`, { headers: bearer(token) });
const agentPut = (token: string, body: unknown) =>
  SELF.fetch(`${BASE}/api/agent/deck`, { method: "PUT", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify(body) });

const text = (t: string, y = 40) => ({ id: crypto.randomUUID(), type: "text" as const, x: 40, y, w: 600, h: 80, rotation: 0, text: t, fontSize: 40, color: "#111111" });
async function personalDeck(ownerId: string, title: string, slides: DeckContent["slides"]) {
  const id = crypto.randomUUID(), slug = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  await env.DB.prepare("INSERT INTO deck (id, slug, owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)")
    .bind(id, slug, ownerId, title, JSON.stringify({ slides })).run();
  return id;
}
async function issueEdit(deckId: string, cookie: string) {
  return cookieReq(`/decks/${deckId}/agent-token`, cookie, "POST");
}
const deckRow = (id: string) => env.DB.prepare("SELECT title, content, revision FROM deck WHERE id = ?").bind(id).first<{ title: string; content: string; revision: number }>();

describe("作成済みのスライドを AI に直してもらう (§4c)", () => {
  it("自分のデッキに結び付き、今の中身を読んで、同じデッキを書き直す（新しいデッキは作らない）", async () => {
    const u = await user(), other = await user();
    const deckId = await personalDeck(u.id, "元のタイトル", [
      { id: crypto.randomUUID(), background: "#FFFFFF", elements: [text("1ページ目")] },
      { id: crypto.randomUUID(), background: "#000000", elements: [text("2ページ目")] },
    ]);
    // 他人のデッキ・チームのスライドには結び付けられない
    expect((await issueEdit(deckId, other.cookie)).status).toBe(404);

    const res = await issueEdit(deckId, u.cookie);
    expect(res.status).toBe(201);
    const issued = await res.json<{ token: string; deckId: string; expiresAt: number; specUrl: string }>();
    expect(issued.deckId).toBe(deckId);
    // 1つのデッキに有効なのは1本だけ
    expect((await issueEdit(deckId, u.cookie)).status).toBe(409);

    const state = await (await agentGet(issued.token)).json<{ deck: { id: string }; content: unknown }>();
    expect(state.deck.id).toBe(deckId);
    const row = await deckRow(deckId);
    expect(state.content).toEqual(exportDeckV2({ title: row!.title, content: JSON.parse(row!.content) }, "http://localhost"));

    const edited = structuredClone(state.content) as { title: string; slides: { elements: { text?: string }[] }[] };
    edited.title = "直したタイトル";
    edited.slides[1]!.elements[0]!.text = "直した2ページ目";
    const put = await agentPut(issued.token, edited);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ created: false, id: deckId });
    expect((await deckRow(deckId))!.title).toBe("直したタイトル");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM deck WHERE owner_id = ?").bind(u.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("AI が書いている間は持ち主も編集できず（423）、取り消すと編集できる", async () => {
    const u = await user();
    const deckId = await personalDeck(u.id, "ロック", [{ id: crypto.randomUUID(), background: "#FFFFFF", elements: [text("a")] }]);
    expect((await cookieReq(`/decks/${deckId}`, u.cookie, "PATCH", { title: "前" })).status).toBe(200);
    expect((await issueEdit(deckId, u.cookie)).status).toBe(201);

    const locked = await cookieReq(`/decks/${deckId}`, u.cookie);
    expect(locked.status).toBe(423);
    expect(await locked.json()).toMatchObject({ error: "agent_writing", agent: { scope: "deck" } });
    expect((await cookieReq(`/decks/${deckId}`, u.cookie, "PATCH", { title: "AI の最中" })).status).toBe(423);
    expect((await deckRow(deckId))!.title).toBe("前");

    expect((await cookieReq(`/decks/${deckId}/agent-token`, u.cookie, "DELETE")).status).toBe(200);
    expect((await cookieReq(`/decks/${deckId}`, u.cookie, "PATCH", { title: "取り消したあと" })).status).toBe(200);
    expect((await deckRow(deckId))!.title).toBe("取り消したあと");
  });

  it("最初の書き込みの前の中身を控え、同じ作業の2回目では置き換えず、「AIの変更を取り消す」で戻す", async () => {
    const u = await user();
    const before = [{ id: crypto.randomUUID(), background: "#FFFFFF", elements: [text("AI の前")] }];
    const deckId = await personalDeck(u.id, "AI の前のタイトル", before);
    const beforeRow = await deckRow(deckId);
    const issued = await (await issueEdit(deckId, u.cookie)).json<{ token: string }>();
    const content = (await (await agentGet(issued.token)).json<{ content: { title: string; slides: { elements: { text?: string }[] }[] } }>()).content;

    for (const label of ["1回目", "2回目"]) {
      const next = structuredClone(content);
      next.title = `AI ${label}`;
      next.slides[0]!.elements[0]!.text = `AI ${label}`;
      expect((await agentPut(issued.token, next)).status).toBe(200);
    }
    const backup = await env.DB.prepare("SELECT title, content FROM deck_ai_backup WHERE deck_id = ?").bind(deckId).first<{ title: string; content: string }>();
    expect(backup).toEqual({ title: beforeRow!.title, content: beforeRow!.content });

    // AI が書いている間は戻せない（423）。取り消したら戻せる
    expect((await cookieReq(`/decks/${deckId}/undo-ai`, u.cookie, "POST")).status).toBe(423);
    expect((await cookieReq(`/decks/${deckId}/agent-token`, u.cookie, "DELETE")).status).toBe(200);
    const shown = await (await cookieReq(`/decks/${deckId}`, u.cookie)).json<{ aiBackupAt: number | null }>();
    expect(shown.aiBackupAt).toEqual(expect.any(Number));

    const undone = await cookieReq(`/decks/${deckId}/undo-ai`, u.cookie, "POST");
    expect(undone.status).toBe(200);
    const after = await deckRow(deckId);
    expect({ title: after!.title, content: after!.content }).toEqual({ title: beforeRow!.title, content: beforeRow!.content });
    expect(after!.revision).toBeGreaterThan(beforeRow!.revision);
    // 戻したら控えは消える（もう一度は戻せない）
    expect((await cookieReq(`/decks/${deckId}/undo-ai`, u.cookie, "POST")).status).toBe(404);
  });

  it("このデッキに上げた画像の src は、読み取りから PUT にそのまま戻せる", async () => {
    const u = await user();
    const deckId = await personalDeck(u.id, "画像", [{ id: crypto.randomUUID(), background: "#FFFFFF", elements: [text("画像のページ")] }]);
    const issued = await (await issueEdit(deckId, u.cookie)).json<{ token: string }>();
    const up = await SELF.fetch(`${BASE}/api/agent/deck/images`, { method: "POST", headers: { ...bearer(issued.token), "content-type": "image/png" }, body: PNG });
    expect(up.status).toBe(201);
    const { src } = await up.json<{ src: string }>();
    const first = (await (await agentGet(issued.token)).json<{ content: { slides: { elements: object[] }[] } }>()).content;
    first.slides[0]!.elements.push({ type: "image-url", x: 500, y: 200, w: 300, h: 200, src });
    expect((await agentPut(issued.token, first)).status).toBe(200);

    const read = (await (await agentGet(issued.token)).json<{ content: { slides: { elements: { type: string; src?: string }[] }[] } }>()).content;
    expect(read.slides[0]!.elements.find((e) => e.type === "image-url")?.src).toBe(src);
    expect((await agentPut(issued.token, read)).status).toBe(200);
  });

  it("v2 の上限を超えるデッキ（61枚）は発行しない。回転と書体は発行でき、losses で知らせる", async () => {
    const owner = await user();
    const big = await personalDeck(owner.id, "大きい", Array.from({ length: 61 }, () => ({ id: crypto.randomUUID(), background: "#ffffff", elements: [text("p")] })));
    const res = await issueEdit(big, owner.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "deck_too_large_for_ai", slides: 61, maxSlides: 60, maxElementsPerSlide: 50 });

    const styled = await personalDeck(owner.id, "飾り", [{ id: crypto.randomUUID(), background: "#ffffff", elements: [
      { ...text("回転"), rotation: 15 },
      { ...text("書体", 200), fontFamily: "M PLUS Rounded 1c" },
    ] }]);
    const ok = await issueEdit(styled, owner.cookie);
    expect(ok.status).toBe(201);
    const { token } = await ok.json<{ token: string }>();
    const state = await (await agentGet(token)).json<{ losses: unknown }>();
    expect(state.losses).toEqual({ truncatedSlides: 0, truncatedElements: 0, rotated: 1, grouped: 0, customFonts: ["M PLUS Rounded 1c"] });
  });
});
