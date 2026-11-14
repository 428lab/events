import { SELF, env, fetchMock } from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { Event, WebhookView } from "@eventer/shared";
import { webhookKindFromUrl } from "@eventer/shared";
import { formatDiscord, formatSlack } from "../src/lib/webhooks.js";

/**
 * コミュニティとイベントごとの Discord / Slack 通知 (docs/webhooks.md)。
 * 宛先の解決（主催＋承諾済みの共催＋イベント、同じ URL は1回）、送る種類、権限、
 * URL を返さないこと、続けての失敗で止まることを見る。外へは送らない（fetchMock）。
 */

const BASE = "https://example.com";
const DAY = 86400000;

interface TestUser { userId: string; cookie: string; handle: string }

async function makeUser(): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const handle = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  ).bind(uid, `t:${uid}`, handle, `表示_${uid.slice(0, 4)}`, Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, uid, Date.now() + DAY).run();
  return { userId: uid, cookie: `eventer_session=${sid}`, handle };
}

async function makeCommunity(owner: TestUser): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID();
  const slug = `c-${id.slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)")
    .bind(id, slug, `community_${id.slice(0, 4)}`, owner.userId, Date.now()).run();
  await env.DB.prepare("INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)")
    .bind(crypto.randomUUID(), id, owner.userId, Date.now()).run();
  return { id, slug };
}

function call(path: string, user: TestUser | null, method = "GET", body?: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { ...(user ? { cookie: user.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createEvent(owner: TestUser, communityId: string): Promise<string> {
  const res = await call("/api/events", owner, "POST", {
    title: "通知の検証",
    venueType: "online",
    venueOnline: "https://example.com/meet",
    startsAt: Date.now() + DAY,
    endsAt: Date.now() + DAY + 3600000,
    communityId,
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { event: Event }).event.id;
  expect((await call(`/api/events/${id}/publish`, owner, "POST")).status).toBe(200);
  return id;
}

// 届いた本文を宛先のパスごとに集める
const received: { path: string; body: Record<string, unknown> }[] = [];
let failPaths = new Set<string>();
const discordUrl = (n: string) => `https://discord.com/api/webhooks/${n}/${"t".repeat(30)}${n}`;
const slackUrl = (n: string) => `https://hooks.slack.com/services/T0000${n}/B0000${n}/secret${n}abcdefgh`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  for (const origin of ["https://discord.com", "https://hooks.slack.com"]) {
    fetchMock.get(origin)
      .intercept({ path: () => true, method: "POST" })
      .reply((opts) => {
        const path = String(opts.path);
        received.push({ path, body: JSON.parse(String(opts.body)) as Record<string, unknown> });
        return { statusCode: failPaths.has(path) ? 404 : 204, data: "" };
      })
      .persist();
  }
});
afterEach(() => {
  received.length = 0;
  failPaths = new Set();
});

const pathOf = (url: string) => new URL(url).pathname;
const hits = (url: string) => received.filter((r) => r.path === pathOf(url));
/** 送るのは応答のあと（waitUntil）なので、届くまで少し待つ */
async function waitHits(url: string, n: number): Promise<void> {
  for (let i = 0; i < 50 && hits(url).length < n; i++) await new Promise((r) => setTimeout(r, 20));
}

async function addWebhook(path: string, user: TestUser, url: string, body: Record<string, unknown> = {}): Promise<WebhookView> {
  const res = await call(path, user, "POST", { url, ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { webhook: WebhookView }).webhook;
}

/** 主催 A、共催 B（承諾済み）、承認待ちの共催 C のイベント */
async function fixture() {
  const host = await makeUser();
  const bOwner = await makeUser();
  const cOwner = await makeUser();
  const a = await makeCommunity(host);
  const b = await makeCommunity(bOwner);
  const c = await makeCommunity(cOwner);
  const eventId = await createEvent(host, a.id);
  await env.DB.prepare("INSERT INTO event_cohost (event_id, community_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .bind(eventId, b.id, Date.now(), Date.now()).run();
  await env.DB.prepare("INSERT INTO event_cohost (event_id, community_id, status, created_at) VALUES (?, ?, 'pending', ?)")
    .bind(eventId, c.id, Date.now()).run();
  return { host, bOwner, cOwner, a, b, c, eventId };
}

describe("Webhook の URL", () => {
  it("Discord / Slack の Webhook だけを受け付け、それ以外（http・別ホスト・余計な部分）は断る", () => {
    expect(webhookKindFromUrl(discordUrl("123456"))).toBe("discord");
    expect(webhookKindFromUrl(discordUrl("123456").replace("discord.com", "discordapp.com"))).toBe("discord");
    expect(webhookKindFromUrl(slackUrl("1"))).toBe("slack");
    for (const bad of [
      discordUrl("123456").replace("https:", "http:"),
      discordUrl("123456").replace("discord.com", "discord.com.evil.example"),
      `${discordUrl("123456")}?x=1`,
      "https://discord.com/api/v10/users/@me",
      "https://hooks.slack.com/workflows/abc",
      "https://example.com/webhook",
      "https://user:pw@hooks.slack.com/services/T00001/B00001/secret1abcdefgh",
    ]) expect(webhookKindFromUrl(bad), bad).toBeNull();
  });
});

describe("送る先と中身", () => {
  it("参加すると主催・承諾済みの共催・イベントの Webhook に送り、承認待ちの共催には送らない。同じ URL は1回", async () => {
    const f = await fixture();
    const shared = discordUrl("111111");
    await addWebhook(`/api/communities/${f.a.id}/webhooks`, f.host, shared);
    await addWebhook(`/api/communities/${f.b.id}/webhooks`, f.bOwner, slackUrl("2"));
    await addWebhook(`/api/communities/${f.c.id}/webhooks`, f.cOwner, discordUrl("333333"));
    // イベントの Webhook に、主催コミュニティと同じ URL を重ねる
    const ev = await addWebhook(`/api/events/${f.eventId}/webhooks`, f.host, shared);
    // URL そのものは返さない
    expect(JSON.stringify(ev)).not.toContain("t".repeat(30));
    expect(ev.urlHint).toMatch(/^discord\.com …/);

    const p = await makeUser();
    expect((await call(`/api/events/${f.eventId}/join`, p, "POST", {})).status).toBe(201);
    await waitHits(shared, 1);
    await waitHits(slackUrl("2"), 1);
    expect(hits(shared)).toHaveLength(1);
    expect(hits(slackUrl("2"))).toHaveLength(1);
    expect(hits(discordUrl("333333"))).toHaveLength(0);
    const embed = (hits(shared)[0]!.body.embeds as { title: string; fields: { value: string }[] }[])[0]!;
    expect(embed.title).toBe("参加: 通知の検証");
    expect(embed.fields.map((x) => x.value).join(" ")).toContain(`@${p.handle}`);
    expect(embed.fields.map((x) => x.value).join(" ")).toContain("確定");

    // キャンセルも送る（種類をオフにした Webhook には送らない）
    await call(`/api/communities/${f.b.id}/webhooks/${(await (await call(`/api/communities/${f.b.id}/webhooks`, f.bOwner)).json() as { webhooks: WebhookView[] }).webhooks[0]!.id}`, f.bOwner, "PATCH", { notifyCancel: false });
    received.length = 0;
    expect((await call(`/api/events/${f.eventId}/join`, p, "DELETE")).status).toBe(200);
    await waitHits(shared, 1);
    expect(hits(shared)).toHaveLength(1);
    expect((hits(shared)[0]!.body.embeds as { title: string }[])[0]!.title).toBe("キャンセル: 通知の検証");
    expect(hits(slackUrl("2"))).toHaveLength(0);
  });

  it("問い合わせは本文を全文で送り、本人の追記も送る。運営の返信は送らない", async () => {
    const f = await fixture();
    await addWebhook(`/api/events/${f.eventId}/webhooks`, f.host, slackUrl("9"));
    const asker = await makeUser();
    const long = "あ".repeat(4500) + "おわり";
    const created = await call(`/api/events/${f.eventId}/inquiries`, asker, "POST", { subject: "質問", body: long });
    expect(created.status).toBe(201);
    const inquiryId = ((await created.json()) as { id: string }).id;
    await waitHits(slackUrl("9"), 1);
    expect(hits(slackUrl("9"))).toHaveLength(1);
    const blocks = hits(slackUrl("9"))[0]!.body.blocks as { type: string; text?: { text: string } }[];
    // 本文の上限（5000字）でも Slack の 3000 字の枠を超えるので複数ブロックに分かれ、つなげると全文になる
    const bodyText = blocks.filter((b) => b.type === "section" && b.text?.text && !b.text.text.startsWith("*<")).map((b) => b.text!.text).join("");
    expect(bodyText).toBe(long);

    expect((await call(`/api/events/${f.eventId}/inquiries/${inquiryId}/messages`, f.host, "POST", { body: "運営の返事" })).status).toBe(200);
    expect(hits(slackUrl("9"))).toHaveLength(1);
    expect((await call(`/api/inquiries/${inquiryId}/messages`, asker, "POST", { body: "追記です" })).status).toBe(200);
    await waitHits(slackUrl("9"), 2);
    expect(hits(slackUrl("9"))).toHaveLength(2);
  });

  it("Discord の問い合わせは長い本文を embed に分け、上限を超える分は「続きはこちら」で切る", () => {
    const m = { topic: "inquiry" as const, eventId: "e", eventTitle: "T", inquiryId: "i", user: { name: "N", handle: "h" }, subject: "S", body: "x".repeat(20000), followUp: false };
    const d = formatDiscord(m) as { embeds: { description: string }[] };
    const total = d.embeds.reduce((n, e) => n + e.description.length, 0);
    expect(d.embeds.length).toBeGreaterThan(1);
    expect(total).toBeLessThanOrEqual(6000);
    expect(d.embeds.at(-1)!.description).toContain("続きはこちら");
    const s = formatSlack(m) as { blocks: unknown[] };
    expect(s.blocks.length).toBeLessThanOrEqual(50);
  });
});

describe("権限・自動停止・テスト送信", () => {
  it("コミュニティの owner/admin とイベントの運営だけが扱え、ほかは 403。共催先の owner でもイベントの Webhook は扱えない", async () => {
    const f = await fixture();
    const stranger = await makeUser();
    expect((await call(`/api/communities/${f.a.id}/webhooks`, stranger)).status).toBe(403);
    expect((await call(`/api/communities/${f.a.id}/webhooks`, stranger, "POST", { url: discordUrl("123456") })).status).toBe(403);
    expect((await call(`/api/events/${f.eventId}/webhooks`, stranger)).status).toBe(403);
    expect((await call(`/api/events/${f.eventId}/webhooks`, f.bOwner, "POST", { url: discordUrl("123456") })).status).toBe(403);
    expect((await call(`/api/communities/${f.a.id}/webhooks`, f.host, "POST", { url: "https://example.com/hook" })).status).toBe(400);
  });

  it("続けて失敗すると止まり、再開で戻る。テスト送信は結果を返す", async () => {
    const f = await fixture();
    const url = discordUrl("555555");
    const w = await addWebhook(`/api/events/${f.eventId}/webhooks`, f.host, url);
    const test = await call(`/api/events/${f.eventId}/webhooks/${w.id}/test`, f.host, "POST");
    expect(await test.json()).toEqual({ ok: true, status: 204 });

    failPaths.add(pathOf(url));
    const list = async () => ((await (await call(`/api/events/${f.eventId}/webhooks`, f.host)).json()) as { webhooks: WebhookView[] }).webhooks[0]!;
    for (let i = 0; i < 5; i++) {
      const p = await makeUser();
      await call(`/api/events/${f.eventId}/join`, p, "POST", {});
      // 送るのは応答のあと。失敗の記録が積み上がるのを1回ずつ待つ
      for (let k = 0; k < 50 && (await list()).failCount < i + 1; k++) await new Promise((r) => setTimeout(r, 20));
    }
    expect(await list()).toMatchObject({ active: false, failCount: 5, lastError: "HTTP 404" });
    received.length = 0;
    await call(`/api/events/${f.eventId}/join`, await makeUser(), "POST", {});
    expect(hits(url)).toHaveLength(0);

    failPaths = new Set();
    expect((await call(`/api/events/${f.eventId}/webhooks/${w.id}`, f.host, "PATCH", { active: true })).status).toBe(200);
    expect(await list()).toMatchObject({ active: true, failCount: 0 });
  });
});
