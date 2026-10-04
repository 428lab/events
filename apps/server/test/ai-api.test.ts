import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import type { CreatedAccessToken } from "@eventer/shared";
import { AI_EVENT_DESCRIPTION_MAX, isoToEpochMs } from "@eventer/shared";
import { bindEnv } from "../src/runtime.js";

/**
 * AI 向け API `/api/ai/v1` (#581 PR2)。設計は docs/ai-integration.md §5・§6。
 *
 * - 全ルート要認証。Cookie でも Bearer でも同じ結果
 * - 書き込み（create_event）は write スコープ。read トークンは 403
 * - トークンは /api/ai/* の外（公開・画面の作成）に届かない
 * - 権限は既存の判定（canViewEvent・公開検索・LEDGER_AUDIENCE_SQL・canAttachCommunity）のまま
 * - create_event は常に draft・created_via='ai'・visibility 既定 unlisted・1時間10件
 */

const BASE = "https://example.com";
const DAY = 24 * 60 * 60 * 1000;

type Actor = { id: string; cookie: string };

async function makeUser(): Promise<Actor> {
  const id = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(id, `t:${id}`, `ai_${id.slice(0, 8)}`, `表示名_${id.slice(0, 4)}`, Date.now())
    .run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, id, Date.now() + DAY)
    .run();
  return { id, cookie: `eventer_session=${sid}` };
}

async function issueToken(actor: Actor, write = false): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/me/access-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: actor.cookie },
    body: JSON.stringify({ name: "Claude Code", write }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as CreatedAccessToken).token;
}

interface EventOpts {
  status?: "draft" | "published";
  visibility?: "public" | "unlisted" | "private";
  description?: string;
  startsAt?: number;
  endsAt?: number;
  title?: string;
}

async function insertEvent(ownerId: string, o: EventOpts = {}): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID();
  const slug = `s${id.slice(0, 7)}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type, status, visibility,
                        scheduling, created_by, created_at, slug)
     VALUES (?, ?, ?, ?, ?, 'offline', ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      o.title ?? `AIテスト_${id.slice(0, 6)}`,
      o.description ?? "",
      o.startsAt ?? now + DAY,
      o.endsAt ?? now + DAY + 3600_000,
      o.status ?? "published",
      o.visibility ?? "public",
      ownerId,
      now,
      slug,
    )
    .run();
  await addMember(id, ownerId, "staff");
  return { id, slug };
}

async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "participant",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, Date.now())
    .run();
}

async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, `c${id.slice(0, 7)}`, `コミュ_${id.slice(0, 4)}`, ownerId, Date.now())
    .run();
  return id;
}

async function addCommunityMember(
  communityId: string,
  userId: string,
  role: "owner" | "admin" | "member",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), communityId, userId, role, Date.now())
    .run();
}

function ai(
  path: string,
  auth: { cookie?: string; token?: string },
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  return SELF.fetch(`${BASE}/api/ai/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function eventRow(id: string) {
  return env.DB.prepare(
    "SELECT status, visibility, created_via, created_by, starts_at, ends_at, scheduling, community_id FROM event WHERE id = ?",
  )
    .bind(id)
    .first<{
      status: string;
      visibility: string;
      created_via: string;
      created_by: string;
      starts_at: number;
      ends_at: number;
      scheduling: number;
      community_id: string | null;
    }>();
}

const draftInput = {
  title: "11月の勉強会",
  description: "## 内容\n- LT",
  startsAt: "2026-11-14T19:00:00+09:00",
  endsAt: "2026-11-14T21:00:00+09:00",
  venueType: "offline",
  venueOffline: "渋谷",
};

beforeEach(() => {
  bindEnv(env as never);
});

describe("認証と到達範囲 (#581 §4.4・§4.5)", () => {
  it("未認証は全ルート 401", async () => {
    const u = await makeUser();
    const { id } = await insertEvent(u.id);
    for (const [path, method] of [
      ["/me", "GET"],
      ["/me/events", "GET"],
      ["/me/communities", "GET"],
      ["/events/search", "GET"],
      [`/events/${id}`, "GET"],
      [`/events/${id}/warikan`, "GET"],
      ["/events", "POST"],
    ] as const) {
      const res = await ai(path, {}, method, method === "POST" ? draftInput : undefined);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("Cookie でも Bearer でも同じ結果を返す", async () => {
    const u = await makeUser();
    const token = await issueToken(u);
    const { id } = await insertEvent(u.id);
    for (const path of ["/me", "/me/events", "/me/communities", `/events/${id}`]) {
      const byCookie = await ai(path, { cookie: u.cookie });
      const byToken = await ai(path, { token });
      expect(byCookie.status, path).toBe(200);
      expect(byToken.status, path).toBe(200);
      expect(await byToken.json(), path).toEqual(await byCookie.json());
    }
  });

  it("whoami は本人の id / username / 表示名 / プロフィール URL", async () => {
    const u = await makeUser();
    const token = await issueToken(u);
    const res = await ai("/me", { token });
    const body = (await res.json()) as Record<string, string>;
    expect(body.id).toBe(u.id);
    expect(body.username).toBe(`ai_${u.id.slice(0, 8)}`);
    expect(body.displayName).toBe(`表示名_${u.id.slice(0, 4)}`);
    expect(body.profileUrl).toMatch(new RegExp(`/users/ai_${u.id.slice(0, 8)}$`));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("read トークンで create_event は 403 insufficient_scope（作られない）", async () => {
    const u = await makeUser();
    const token = await issueToken(u, false);
    const res = await ai("/events", { token }, "POST", draftInput);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_scope" });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM event WHERE created_by = ?")
      .bind(u.id)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("write トークンでも公開・画面の作成には届かない（401 token_not_allowed_here）", async () => {
    const u = await makeUser();
    const token = await issueToken(u, true);
    const created = await ai("/events", { token }, "POST", draftInput);
    const { event } = (await created.json()) as { event: { id: string } };
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const publish = await SELF.fetch(`${BASE}/api/events/${event.id}/publish`, {
      method: "POST",
      headers,
    });
    expect(publish.status).toBe(401);
    expect(await publish.json()).toEqual({ error: "token_not_allowed_here" });
    const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "published" }),
    });
    expect(patch.status).toBe(401);
    const web = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(draftInput),
    });
    expect(web.status).toBe(401);
    expect((await eventRow(event.id))?.status).toBe("draft");
  });
});

describe("読み取りの公開範囲 (#581 §6.1)", () => {
  it("get_event: 他人の下書き・非公開は ID でも slug でも 404、公開は見える", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const token = await issueToken(other);
    const draft = await insertEvent(owner.id, { status: "draft" });
    const priv = await insertEvent(owner.id, { visibility: "private" });
    const pub = await insertEvent(owner.id);
    for (const key of [draft.id, draft.slug, priv.id, priv.slug]) {
      expect((await ai(`/events/${key}`, { token })).status, key).toBe(404);
    }
    for (const key of [pub.id, pub.slug]) {
      const res = await ai(`/events/${key}`, { token });
      expect(res.status, key).toBe(200);
      const body = (await res.json()) as { event: { id: string }; myRole: unknown };
      expect(body.event.id).toBe(pub.id);
      expect(body.myRole).toBeNull();
    }
  });

  it("get_event: 本人の下書きは見え、参加状態・ISO 日時・URL が付く", async () => {
    const u = await makeUser();
    const token = await issueToken(u);
    const startsAt = Date.UTC(2026, 10, 14, 10, 0);
    const { id, slug } = await insertEvent(u.id, {
      status: "draft",
      startsAt,
      endsAt: startsAt + 3600_000,
    });
    const res = await ai(`/events/${id}`, { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { status: string; startsAt: string; urls: { view: string; short: string } };
      myRole: string;
      myStatus: string;
      slots: unknown[];
    };
    expect(body.event.status).toBe("draft");
    expect(body.event.startsAt).toBe("2026-11-14T10:00:00.000Z");
    expect(body.event.urls.view).toMatch(new RegExp(`/events/${id}$`));
    expect(body.event.urls.short).toMatch(new RegExp(`/e/${slug}$`));
    expect(body.myRole).toBe("staff");
    expect(body.myStatus).toBe("confirmed");
    expect(body.slots).toEqual([]);
  });

  it("get_event: 説明文は 4,000 字で切って descriptionTruncated を立てる", async () => {
    const u = await makeUser();
    const token = await issueToken(u);
    const long = await insertEvent(u.id, { description: "あ".repeat(AI_EVENT_DESCRIPTION_MAX + 10) });
    const short = await insertEvent(u.id, { description: "短い" });
    const a = (await (await ai(`/events/${long.id}`, { token })).json()) as {
      event: { description: string; descriptionTruncated: boolean };
    };
    expect(a.event.description).toHaveLength(AI_EVENT_DESCRIPTION_MAX);
    expect(a.event.descriptionTruncated).toBe(true);
    const b = (await (await ai(`/events/${short.id}`, { token })).json()) as {
      event: { description: string; descriptionTruncated: boolean };
    };
    expect(b.event).toMatchObject({ description: "短い", descriptionTruncated: false });
  });

  it("search_events: 公開・公開中だけ。下書き・限定公開・非公開は出ず、本文も載せない", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const token = await issueToken(u);
    const tag = `検索${crypto.randomUUID().slice(0, 6)}`;
    const pub = await insertEvent(owner.id, { title: `${tag}公開`, description: "本文" });
    await insertEvent(owner.id, { title: `${tag}下書き`, status: "draft" });
    await insertEvent(owner.id, { title: `${tag}限定`, visibility: "unlisted" });
    await insertEvent(owner.id, { title: `${tag}非公開`, visibility: "private" });
    const res = await ai(`/events/search?q=${encodeURIComponent(tag)}`, { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Record<string, unknown>[]; total: number };
    expect(body.events.map((e) => e.id)).toEqual([pub.id]);
    expect(body.total).toBe(1);
    expect(body.events[0]).not.toHaveProperty("description");
  });

  it("search_events: limit は 20 まで、from/to は ISO 8601（時差必須）", async () => {
    const u = await makeUser();
    const token = await issueToken(u);
    expect((await ai("/events/search?limit=20", { token })).status).toBe(200);
    expect((await ai("/events/search?limit=21", { token })).status).toBe(400);
    expect((await ai(`/events/search?from=${Date.now()}`, { token })).status).toBe(400);
    expect((await ai("/events/search?from=2026-11-01T00:00:00", { token })).status).toBe(400);
    const tag = `期間${crypto.randomUUID().slice(0, 6)}`;
    const start = Date.UTC(2031, 0, 10, 3);
    const inRange = await insertEvent(u.id, { title: `${tag}A`, startsAt: start, endsAt: start + 3600_000 });
    await insertEvent(u.id, { title: `${tag}B`, startsAt: start + 30 * DAY, endsAt: start + 30 * DAY + 3600_000 });
    const res = await ai(
      `/events/search?q=${encodeURIComponent(tag)}&from=${encodeURIComponent("2031-01-01T00:00:00+09:00")}&to=${encodeURIComponent("2031-01-31T00:00:00+09:00")}`,
      { token },
    );
    const body = (await res.json()) as { events: { id: string }[] };
    expect(body.events.map((e) => e.id)).toEqual([inRange.id]);
  });

  it("list_my_events: 本人の下書きを含み、phase で開催予定と過去を分ける", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const token = await issueToken(u);
    const now = Date.now();
    const draft = await insertEvent(u.id, { status: "draft" });
    const past = await insertEvent(u.id, { startsAt: now - 2 * DAY, endsAt: now - DAY });
    await insertEvent(other.id);
    const up = (await (await ai("/me/events", { token })).json()) as {
      phase: string;
      events: { id: string; myRole: string; status: string }[];
    };
    expect(up.phase).toBe("upcoming");
    expect(up.events.map((e) => e.id)).toEqual([draft.id]);
    expect(up.events[0]).toMatchObject({ myRole: "staff", status: "draft" });
    expect(up.events[0]).not.toHaveProperty("description");
    const pastRes = (await (await ai("/me/events?phase=past", { token })).json()) as {
      events: { id: string }[];
    };
    expect(pastRes.events.map((e) => e.id)).toEqual([past.id]);
    expect((await ai("/me/events?phase=all", { token })).status).toBe(400);
  });

  it("get_warikan: 帳簿の audience 外は 404、当事者には自分の精算行に mine: true", async () => {
    const owner = await makeUser();
    const payer = await makeUser();
    const outsider = await makeUser();
    const { id } = await insertEvent(owner.id);
    await addMember(id, payer.id);
    const exp = await SELF.fetch(`${BASE}/api/events/${id}/warikan/expenses`, {
      method: "POST",
      headers: { cookie: payer.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        payerUserId: payer.id,
        amount: 3000,
        title: "会場費",
        shares: [
          { userId: payer.id, weight: 1 },
          { userId: owner.id, weight: 1 },
        ],
      }),
    });
    expect(exp.status).toBe(201);

    const outsiderToken = await issueToken(outsider);
    // 公開イベントなので get_event は見えるが、帳簿は見えない
    expect((await ai(`/events/${id}`, { token: outsiderToken })).status).toBe(200);
    expect((await ai(`/events/${id}/warikan`, { token: outsiderToken })).status).toBe(404);

    const ownerToken = await issueToken(owner);
    const res = await ai(`/events/${id}/warikan`, { token: ownerToken });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settlements: { fromUserId: string; toUserId: string; amount: number; mine: boolean }[];
    };
    expect(body.settlements).toHaveLength(1);
    expect(body.settlements[0]).toMatchObject({
      fromUserId: owner.id,
      toUserId: payer.id,
      amount: 1500,
      mine: true,
    });
  });

  it("get_warikan: 見られないイベント（他人の下書き）は帳簿の有無に関係なく 404", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const { id } = await insertEvent(owner.id, { status: "draft" });
    const token = await issueToken(u);
    expect((await ai(`/events/${id}/warikan`, { token })).status).toBe(404);
  });

  it("list_my_communities: owner/admin のものだけ（member は出ない）", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const token = await issueToken(u);
    const owned = await makeCommunity(u.id);
    await addCommunityMember(owned, u.id, "owner");
    const admin = await makeCommunity(other.id);
    await addCommunityMember(admin, u.id, "admin");
    const member = await makeCommunity(other.id);
    await addCommunityMember(member, u.id, "member");
    const body = (await (await ai("/me/communities", { token })).json()) as {
      communities: { id: string; url: string }[];
    };
    expect(body.communities.map((c) => c.id).sort()).toEqual([owned, admin].sort());
    expect(body.communities[0]).not.toHaveProperty("description");
  });
});

describe("create_event (#581 §5.3)", () => {
  it("常に下書き・created_via='ai'・visibility 既定 unlisted。ISO 日時を epoch に直し、URL 3種を返す", async () => {
    const u = await makeUser();
    const token = await issueToken(u, true);
    const res = await ai("/events", { token }, "POST", draftInput);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      event: { id: string; slug: string; status: string; visibility: string; startsAt: string };
      urls: { view: string; edit: string; short: string };
      next: string;
    };
    expect(body.event).toMatchObject({ status: "draft", visibility: "unlisted" });
    expect(body.event.startsAt).toBe("2026-11-14T10:00:00.000Z");
    expect(body.urls.view).toMatch(new RegExp(`/events/${body.event.id}$`));
    expect(body.urls.edit).toMatch(new RegExp(`/events/${body.event.id}/edit$`));
    expect(body.urls.short).toMatch(new RegExp(`/e/${body.event.slug}$`));
    expect(body.next).toContain("下書き");
    const row = await eventRow(body.event.id);
    expect(row).toMatchObject({
      status: "draft",
      visibility: "unlisted",
      created_via: "ai",
      created_by: u.id,
      starts_at: Date.UTC(2026, 10, 14, 10, 0),
      ends_at: Date.UTC(2026, 10, 14, 12, 0),
      scheduling: 0,
    });
    // 作成者は staff として入る（画面の作成と同じ本体）
    const member = await env.DB.prepare(
      "SELECT role, status FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(body.event.id, u.id)
      .first<{ role: string; status: string }>();
    expect(member).toEqual({ role: "staff", status: "confirmed" });
  });

  it("Cookie でも作れる（created_via='ai'）。画面の POST /api/events は 'web' のまま", async () => {
    const u = await makeUser();
    const viaAi = await ai("/events", { cookie: u.cookie }, "POST", draftInput);
    expect(viaAi.status).toBe(201);
    const a = (await viaAi.json()) as { event: { id: string } };
    expect((await eventRow(a.event.id))?.created_via).toBe("ai");
    const viaWeb = await SELF.fetch(`${BASE}/api/events`, {
      method: "POST",
      headers: { cookie: u.cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "画面", venueType: "online" }),
    });
    expect(viaWeb.status).toBe(201);
    const w = (await viaWeb.json()) as { event: { id: string } };
    expect(await eventRow(w.event.id)).toMatchObject({ created_via: "web", visibility: "public" });
  });

  it("日程調整なら日時を省略でき、visibility は指定どおり", async () => {
    const u = await makeUser();
    const token = await issueToken(u, true);
    const res = await ai("/events", { token }, "POST", {
      title: "日程未定の回",
      venueType: "online",
      scheduling: true,
      visibility: "private",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { event: { id: string; startsAt: unknown; scheduling: boolean } };
    expect(body.event).toMatchObject({ startsAt: null, scheduling: true });
    expect(await eventRow(body.event.id)).toMatchObject({
      starts_at: 0,
      ends_at: 0,
      scheduling: 1,
      visibility: "private",
    });
  });

  it("不正な日時・順序・欠落、受けない項目（status・画像・参加枠）は 400", async () => {
    const u = await makeUser();
    const token = await issueToken(u, true);
    const cases: [string, Record<string, unknown>][] = [
      ["時差なし", { ...draftInput, startsAt: "2026-11-14T19:00:00" }],
      ["存在しない日", { ...draftInput, startsAt: "2026-02-30T19:00:00+09:00" }],
      ["epoch ms", { ...draftInput, startsAt: 1794650400000 }],
      ["日付だけ", { ...draftInput, startsAt: "2026-11-14" }],
      ["終了が開始より前", { ...draftInput, endsAt: "2026-11-14T18:00:00+09:00" }],
      ["日程調整でないのに日時なし", { title: "x", venueType: "online" }],
      ["status", { ...draftInput, status: "published" }],
      ["画像", { ...draftInput, imageUrl: "https://example.com/a.png" }],
      ["参加枠", { ...draftInput, slots: [{ name: "一般", capacity: 10 }] }],
      ["複製元", { ...draftInput, sourceEventId: "x" }],
    ];
    for (const [label, input] of cases) {
      const res = await ai("/events", { token }, "POST", input);
      expect(res.status, label).toBe(400);
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM event WHERE created_by = ?")
      .bind(u.id)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("communityId は運営（owner/admin）するものだけ。メンバーでは 403", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const token = await issueToken(u, true);
    const managed = await makeCommunity(u.id);
    await addCommunityMember(managed, u.id, "owner");
    const joined = await makeCommunity(other.id);
    await addCommunityMember(joined, u.id, "member");
    const ng = await ai("/events", { token }, "POST", { ...draftInput, communityId: joined });
    expect(ng.status).toBe(403);
    const okRes = await ai("/events", { token }, "POST", { ...draftInput, communityId: managed });
    expect(okRes.status).toBe(201);
    const body = (await okRes.json()) as { event: { id: string } };
    expect((await eventRow(body.event.id))?.community_id).toBe(managed);
  });

  it("1時間に10件まで。11件目は 429（画面からの作成と1時間より前の分は数えない）", async () => {
    const u = await makeUser();
    const token = await issueToken(u, true);
    // 1時間より前の AI 作成と、画面からの作成は数えない
    const old = await insertEvent(u.id);
    await env.DB.prepare("UPDATE event SET created_via = 'ai', created_at = ? WHERE id = ?")
      .bind(Date.now() - 61 * 60 * 1000, old.id)
      .run();
    await insertEvent(u.id);
    for (let i = 0; i < 10; i++) {
      const res = await ai("/events", { token }, "POST", { ...draftInput, title: `回${i}` });
      expect(res.status, `${i + 1}件目`).toBe(201);
    }
    const res = await ai("/events", { token }, "POST", draftInput);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "ai_create_rate_limited" });
  });
});

describe("isoToEpochMs (#581)", () => {
  it("時差付きの ISO 8601 だけを受け、繰り上がる日付は null", () => {
    expect(isoToEpochMs("2026-11-14T19:00:00+09:00")).toBe(Date.UTC(2026, 10, 14, 10, 0));
    expect(isoToEpochMs("2026-11-14T19:00+09:00")).toBe(Date.UTC(2026, 10, 14, 10, 0));
    expect(isoToEpochMs("2026-11-14T10:00:00.500Z")).toBe(Date.UTC(2026, 10, 14, 10, 0, 0, 500));
    expect(isoToEpochMs("2026-11-14T05:30:00-04:30")).toBe(Date.UTC(2026, 10, 14, 10, 0));
    expect(isoToEpochMs("2026-11-14T19:00:00")).toBeNull();
    expect(isoToEpochMs("2026-02-29T00:00:00Z")).toBeNull();
    expect(isoToEpochMs("2028-02-29T00:00:00Z")).toBe(Date.UTC(2028, 1, 29));
    expect(isoToEpochMs("2026-11-14T24:00:00Z")).toBeNull();
    expect(isoToEpochMs("not a date")).toBeNull();
  });
});
