import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { EventLiveState, LivePresenter, ScheduleItem } from "@eventer/shared";

/** 発表者のスライドを配信に出す (#571)。
 * 紐付けは登壇者本人の同意なので、付けるのは本人だけ・外すのは本人か staff、
 * 有効かどうかの判定は presenterSlides.ts の1か所だけで決まることを確かめる。 */

const BASE = "https://example.com";
const json = { "content-type": "application/json" };

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const userId = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)")
    .bind(userId, `nostr:${userId}`, `u_${userId.slice(0, 8)}`, `名前${userId.slice(0, 4)}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, userId, Date.now() + 86400000).run();
  return { userId, cookie: `eventer_session=${sid}` };
}

async function addMember(eventId: string, userId: string, role: "participant" | "staff"): Promise<void> {
  await env.DB.prepare("INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)")
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now()).run();
}

async function makeDeck(ownerId: string, title: string, pages: number): Promise<string> {
  const id = crypto.randomUUID();
  const slides = Array.from({ length: pages }, (_, i) => ({ id: `s${i}`, background: "#ffffff", elements: [] }));
  await env.DB.prepare("INSERT INTO deck (id, slug, owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, `slug${id.slice(0, 8)}`, ownerId, title, JSON.stringify({ slides }), Date.now(), Date.now()).run();
  return id;
}

/** 公開イベント・staff・登壇者2人・コマ（A の発表／B の発表／フリーテキスト／裏方の A）を用意する */
async function fixture() {
  const staff = await makeUser();
  const speakerA = await makeUser();
  const speakerB = await makeUser();
  const other = await makeUser();
  const eventId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO event (id, title, description, starts_at, ends_at, venue_type, participation_type, status, created_by, created_at) VALUES (?, 'LT', '', ?, ?, 'online', 'individual', 'published', ?, ?)")
    .bind(eventId, Date.now() + 100000, Date.now() + 200000, staff.userId, Date.now()).run();
  await addMember(eventId, staff.userId, "staff");
  for (const u of [speakerA, speakerB, other]) await addMember(eventId, u.userId, "participant");
  const items = { opening: crypto.randomUUID(), talkA: crypto.randomUUID(), talkB: crypto.randomUUID(), freeText: crypto.randomUUID(), backstageA: crypto.randomUUID() };
  const rows: Array<[string, string, string | null, string, string]> = [
    [items.opening, "オープニング", null, "", "public"],
    [items.talkA, "LT 1", speakerA.userId, "", "public"],
    [items.talkB, "LT 2", speakerB.userId, "", "public"],
    [items.freeText, "LT 3", null, "飛び入りさん", "public"],
    [items.backstageA, "設営", speakerA.userId, "", "staff"],
  ];
  for (const [i, [id, title, speakerUserId, speakerName, visibility]] of rows.entries()) {
    await env.DB.prepare("INSERT INTO event_schedule_item (id, event_id, title, description, duration_min, starts_at, speaker_user_id, speaker_name, material_url, sort_order, created_at, visibility) VALUES (?, ?, ?, '', 10, NULL, ?, ?, '', ?, ?, ?)")
      .bind(id, eventId, title, speakerUserId, speakerName, i, Date.now(), visibility).run();
  }
  const deckA = await makeDeck(speakerA.userId, "A のスライド", 6);
  const deckA2 = await makeDeck(speakerA.userId, "A の2本目", 3);
  const deckB = await makeDeck(speakerB.userId, "B のスライド", 4);
  const deckStaff = await makeDeck(staff.userId, "運営のお知らせ", 2);
  return { eventId, staff, speakerA, speakerB, other, items, deckA, deckA2, deckB, deckStaff };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function putLink(f: Fixture, itemId: string, cookie: string, deckId: string | null) {
  return SELF.fetch(`${BASE}/api/events/${f.eventId}/timetable/${itemId}/live-deck`, { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ deckId }) });
}
function patchState(f: Fixture, cookie: string, body: object) {
  return SELF.fetch(`${BASE}/api/events/${f.eventId}/live-state`, { method: "PATCH", headers: { ...json, cookie }, body: JSON.stringify(body) });
}
async function presenters(f: Fixture, cookie = f.staff.cookie): Promise<LivePresenter[]> {
  const res = await SELF.fetch(`${BASE}/api/events/${f.eventId}/live-presenters`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { presenters: LivePresenter[] }).presenters;
}
async function deckOf(f: Fixture, itemId: string) {
  return (await presenters(f)).find((p) => p.itemId === itemId)?.deck ?? null;
}
async function liveState(f: Fixture): Promise<EventLiveState> {
  return (await (await SELF.fetch(`${BASE}/api/events/${f.eventId}/live-state`, { headers: { cookie: f.staff.cookie } })).json()) as EventLiveState;
}

describe("配信用デッキの紐付け PUT timetable/:itemId/live-deck (#571)", () => {
  it("登壇者本人は付け外しでき、staff は外すだけ、他の人は 403", async () => {
    const f = await fixture();
    expect((await putLink(f, f.items.talkA, f.other.cookie, f.deckA)).status).toBe(403);
    // staff でも代わりには付けられない（staff 自身のデッキでも、本人のデッキでも）
    expect((await putLink(f, f.items.talkA, f.staff.cookie, f.deckStaff)).status).toBe(403);
    expect((await putLink(f, f.items.talkA, f.staff.cookie, f.deckA)).status).toBe(403);
    const set = await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ liveDeck: { id: f.deckA, title: "A のスライド", slideCount: 6 } });
    expect((await putLink(f, f.items.talkA, f.other.cookie, null)).status).toBe(403);
    expect(await deckOf(f, f.items.talkA)).not.toBeNull();
    expect((await putLink(f, f.items.talkA, f.staff.cookie, null)).status).toBe(200);
    expect(await deckOf(f, f.items.talkA)).toBeNull();
    // 本人も外せる
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA2)).status).toBe(200);
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, null)).status).toBe(200);
    expect(await deckOf(f, f.items.talkA)).toBeNull();
  });

  it("自分のものではないデッキは付けられず、他人のコマ・裏方のコマにも付けられない", async () => {
    const f = await fixture();
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckB)).status).toBe(403);
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, "no-such-deck")).status).toBe(403);
    expect((await putLink(f, f.items.talkB, f.speakerA.cookie, f.deckA)).status).toBe(403);
    expect((await putLink(f, f.items.backstageA, f.speakerA.cookie, f.deckA)).status).toBe(404);
    const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM event_schedule_item WHERE event_id = ? AND live_deck_id IS NOT NULL").bind(f.eventId).first<{ n: number }>();
    expect(raw?.n).toBe(0);
  });

  it("担当者本人と staff にだけタイムテーブルで紐付けが見え、参加者には見えない", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    const read = async (cookie?: string) => ((await (await SELF.fetch(`${BASE}/api/events/${f.eventId}/timetable`, { headers: cookie ? { cookie } : undefined })).json()) as { items: ScheduleItem[] }).items.find((it) => it.id === f.items.talkA)!;
    expect((await read(f.speakerA.cookie)).liveDeck).toEqual({ id: f.deckA, title: "A のスライド", slideCount: 6 });
    expect((await read(f.staff.cookie)).liveDeck?.id).toBe(f.deckA);
    expect((await read(f.other.cookie)).liveDeck ?? null).toBeNull();
    expect((await read()).liveDeck ?? null).toBeNull();
    expect(JSON.stringify(await read(f.speakerA.cookie))).not.toContain("slug");
  });
});

describe("有効な紐付けの条件 (#571 3.2)", () => {
  it("担当者が替わったら staff の全体保存で外れ、替わらなければ残る", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    const save = async (speakerUserId: string) => {
      const cur = (await (await SELF.fetch(`${BASE}/api/events/${f.eventId}/timetable`, { headers: { cookie: f.staff.cookie } })).json()) as { items: ScheduleItem[]; version: number };
      const items = cur.items.map((it) => ({ id: it.id, title: it.title, durationMin: it.durationMin, speakerUserId: it.id === f.items.talkA ? speakerUserId : it.speakerUserId, speakerName: it.speakerName, visibility: it.visibility }));
      const res = await SELF.fetch(`${BASE}/api/events/${f.eventId}/timetable`, { method: "PUT", headers: { ...json, cookie: f.staff.cookie }, body: JSON.stringify({ version: cur.version, items }) });
      expect(res.status).toBe(200);
    };
    const column = async () => (await env.DB.prepare("SELECT live_deck_id FROM event_schedule_item WHERE id = ?").bind(f.items.talkA).first<{ live_deck_id: string | null }>())?.live_deck_id;
    await save(f.speakerA.userId);
    expect(await column()).toBe(f.deckA);
    expect(await deckOf(f, f.items.talkA)).not.toBeNull();
    await save(f.speakerB.userId);
    expect(await column()).toBeNull();
    // 元に戻しても前の同意は復活しない
    await save(f.speakerA.userId);
    expect(await deckOf(f, f.items.talkA)).toBeNull();
  });

  it("担当者がイベントを抜けると無効、戻れば有効（列は残る）", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    await env.DB.prepare("UPDATE event_member SET status = 'canceled' WHERE event_id = ? AND user_id = ?").bind(f.eventId, f.speakerA.userId).run();
    expect(await deckOf(f, f.items.talkA)).toBeNull();
    expect((await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA })).status).toBe(200);
    expect((await liveState(f)).deckId).toBeNull();
    // 抜けた本人は付け直せない
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA2)).status).toBe(403);
    await env.DB.prepare("UPDATE event_member SET status = 'confirmed' WHERE event_id = ? AND user_id = ?").bind(f.eventId, f.speakerA.userId).run();
    expect((await deckOf(f, f.items.talkA))?.id).toBe(f.deckA);
  });

  it("デッキを削除すると紐付けも配信中のデッキも外れる", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA });
    expect((await liveState(f)).deckId).toBe(f.deckA);
    expect((await SELF.fetch(`${BASE}/api/decks/${f.deckA}`, { method: "DELETE", headers: { cookie: f.speakerA.cookie } })).status).toBe(200);
    expect(await deckOf(f, f.items.talkA)).toBeNull();
    const row = await env.DB.prepare("SELECT live_deck_id FROM event_schedule_item WHERE id = ?").bind(f.items.talkA).first<{ live_deck_id: string | null }>();
    expect(row?.live_deck_id).toBeNull();
    const state = await liveState(f);
    expect(state.deckId).toBeNull();
    expect(state.presenterItemId).toBe(f.items.talkA);
  });

  it("コマが裏方になると無効になり、発表者一覧からも消える", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    await env.DB.prepare("UPDATE event_schedule_item SET visibility = 'staff' WHERE id = ?").bind(f.items.talkA).run();
    expect((await presenters(f)).some((p) => p.itemId === f.items.talkA)).toBe(false);
    expect((await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA })).status).toBe(404);
  });
});

describe("マイグレーション 0100 (#571)", () => {
  it("紐付けの付け外しでは 0092 のカード再生成トリガーが発火しない", async () => {
    const f = await fixture();
    const generation = async () => (await env.DB.prepare("SELECT card_image_generation AS g FROM user WHERE id = ?").bind(f.speakerA.userId).first<{ g: string | null }>())?.g;
    const before = await generation();
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA)).status).toBe(200);
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, null)).status).toBe(200);
    expect(await generation()).toBe(before);
  });

  it("コマを削除すると選ばれていた発表者は外れる（ON DELETE SET NULL）", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA });
    await env.DB.prepare("DELETE FROM event_schedule_item WHERE id = ?").bind(f.items.talkA).run();
    expect((await liveState(f)).presenterItemId).toBeNull();
  });
});

describe("発表者一覧 GET live-presenters (#571)", () => {
  it("staff だけが読め、担当者付きのコマをタイムテーブル順に返し、slug を含まない", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    for (const cookie of [f.other.cookie, f.speakerA.cookie]) {
      expect((await SELF.fetch(`${BASE}/api/events/${f.eventId}/live-presenters`, { headers: { cookie } })).status).toBe(403);
    }
    const res = await SELF.fetch(`${BASE}/api/events/${f.eventId}/live-presenters`, { headers: { cookie: f.staff.cookie } });
    const text = await res.text();
    expect(text).not.toContain("slug");
    const list = (JSON.parse(text) as { presenters: LivePresenter[] }).presenters;
    expect(list.map((p) => p.itemId)).toEqual([f.items.talkA, f.items.talkB, f.items.freeText]);
    expect(list[0]).toMatchObject({ title: "LT 1", linkable: true, deck: { id: f.deckA, title: "A のスライド", slideCount: 6 } });
    expect(list[0].speaker?.id).toBe(f.speakerA.userId);
    expect(list[1]).toMatchObject({ linkable: true, deck: null });
    expect(list[2]).toMatchObject({ linkable: false, speaker: null, speakerName: "飛び入りさん", deck: null });
  });
});

describe("PATCH live-state の発表者選択とデッキ直接指定 (#571)", () => {
  it("発表者を選ぶとデッキを解決して 1 ページ目、同じ発表者の選び直しはページを保つ", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    await putLink(f, f.items.talkB, f.speakerB.cookie, f.deckB);
    let res = await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ presenterItemId: f.items.talkA, deckId: f.deckA, deckPage: 0 });
    expect((await patchState(f, f.staff.cookie, { deckPage: 3 })).status).toBe(200);
    res = await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA });
    expect(await res.json()).toMatchObject({ deckId: f.deckA, deckPage: 3 });
    // 中身は live-deck-content でそのまま読める（他人のデッキだが、紐付けで同意済み）
    const content = (await (await SELF.fetch(`${BASE}/api/events/${f.eventId}/live-deck-content`, { headers: { cookie: f.staff.cookie } })).json()) as { deck: { id: string } | null };
    expect(content.deck?.id).toBe(f.deckA);
    res = await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkB });
    expect(await res.json()).toMatchObject({ presenterItemId: f.items.talkB, deckId: f.deckB, deckPage: 0 });
    // 未登録の発表者はデッキなし
    await patchState(f, f.staff.cookie, { deckPage: 2 });
    res = await patchState(f, f.staff.cookie, { presenterItemId: f.items.freeText });
    expect(await res.json()).toMatchObject({ presenterItemId: f.items.freeText, deckId: null, deckPage: 0 });
    // 発表者の選択とデッキの直接指定は混ぜられない
    expect((await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA, deckId: f.deckStaff })).status).toBe(400);
    expect((await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA, deckPage: 2 })).status).toBe(400);
    // 発表者の選択は staff だけ
    expect((await patchState(f, f.speakerA.cookie, { presenterItemId: f.items.talkA })).status).toBe(403);
  });

  it("配信中のデッキの紐付けを外すと deck_id も消える。付け替えると新しいデッキの 1 ページ目になる", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA });
    await patchState(f, f.staff.cookie, { deckPage: 4 });
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA2);
    expect(await liveState(f)).toMatchObject({ deckId: f.deckA2, deckPage: 0 });
    expect((await putLink(f, f.items.talkA, f.staff.cookie, null)).status).toBe(200);
    expect(await liveState(f)).toMatchObject({ presenterItemId: f.items.talkA, deckId: null });
    const content = (await (await SELF.fetch(`${BASE}/api/events/${f.eventId}/live-deck-content`, { headers: { cookie: f.staff.cookie } })).json()) as { deck: unknown };
    expect(content.deck).toBeNull();
  });

  it("配信中でないコマの紐付けを外しても、いま出ている別のデッキは消えない", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    await putLink(f, f.items.talkB, f.speakerB.cookie, f.deckB);
    await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkB });
    await patchState(f, f.staff.cookie, { deckPage: 2 });
    expect((await putLink(f, f.items.talkA, f.speakerA.cookie, null)).status).toBe(200);
    expect(await liveState(f)).toMatchObject({ presenterItemId: f.items.talkB, deckId: f.deckB, deckPage: 2 });
  });

  it("デッキの直接指定は操作者自身のデッキだけ。直接指定すると発表者の選択は外れる", async () => {
    const f = await fixture();
    await putLink(f, f.items.talkA, f.speakerA.cookie, f.deckA);
    expect((await patchState(f, f.staff.cookie, { deckId: f.deckA, deckPage: 0 })).status).toBe(403);
    expect((await patchState(f, f.staff.cookie, { deckId: "no-such-deck" })).status).toBe(403);
    expect((await liveState(f)).deckId).toBeNull();
    await patchState(f, f.staff.cookie, { presenterItemId: f.items.talkA });
    const res = await patchState(f, f.staff.cookie, { deckId: f.deckStaff, deckPage: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deckId: f.deckStaff, presenterItemId: null, deckPage: 0 });
    expect((await patchState(f, f.staff.cookie, { deckId: null })).status).toBe(200);
    expect((await liveState(f)).deckId).toBeNull();
  });
});
