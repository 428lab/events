import { env, createExecutionContext, waitOnExecutionContext, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AdminInquiry, Inquiry, InquiryDetail } from "@eventer/shared";

/**
 * 運営からメンバーへ個別に連絡する（運営から始める問い合わせ。オーナー決定 2026-11-22）。
 *
 * 守ること:
 * 1. 運営 → 相手: ベル通知とメール（相手の通知設定どおり）。Webhook には流さない
 * 2. 相手の返信: Webhook に流す（「運営からの連絡への返信」）。メールは**連絡を始めたスタッフだけ**
 * 3. 本人が始めた問い合わせ: 運営全員にメール（それまでのベルだけ＝決定3 を変更）。運営の返信は本人にメール
 * 4. 送れるのは確定スタッフだけ。相手はそのイベントのメンバーで自分以外
 *
 * メールと Webhook は応答のあと（waitUntil）に送るので、worker を実行文脈つきで直接叩き、
 * 文脈の終わりまで待ってから外への送信（fetchMock）を数える。
 */

const BASE = "https://example.com";
const DAY = 86_400_000;
const sql = (q: string, ...v: unknown[]) => env.DB.prepare(q).bind(...v).run();

type Actor = { id: string; cookie: string; handle: string; email: string };

async function user(): Promise<Actor> {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), handle = `u_${id.slice(0, 8)}`;
  const email = `${handle}@example.com`;
  await sql("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, 1)", id, `test:${id}`, handle);
  await sql("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)", sid, id, Date.now() + DAY);
  await sql("INSERT INTO identity(id,user_id,provider,provider_user_id,email,created_at) VALUES(?,?,'google',?,?,1)", crypto.randomUUID(), id, id, email);
  return { id, cookie: `eventer_session=${sid}`, handle, email };
}

async function member(eventId: string, u: Actor, role: string, status = "confirmed") {
  await sql(
    "INSERT INTO event_member (id, event_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?, 1)",
    crypto.randomUUID(), eventId, u.id, role, status,
  );
}

const discordUrl = `https://discord.com/api/webhooks/777777/${"t".repeat(30)}777777`;

/** 主催（host）と運営（cohost）と登壇者（speaker）のイベント。イベントの Webhook を1つ登録 */
async function fixture() {
  const host = await user(), cohost = await user(), speaker = await user();
  const eventId = crypto.randomUUID();
  await sql(
    `INSERT INTO event (id, slug, title, created_by, created_at, starts_at, ends_at, venue_type, status, visibility)
     VALUES (?, ?, '連絡の検証', ?, 1, ?, ?, 'online', 'published', 'public')`,
    eventId, eventId.slice(0, 8), host.id, Date.now() + DAY, Date.now() + 2 * DAY,
  );
  await member(eventId, host, "staff");
  await member(eventId, cohost, "staff");
  await member(eventId, speaker, "participant");
  await sql(
    `INSERT INTO webhook (id, scope, event_id, kind, url, created_by, created_at)
     VALUES (?, 'event', ?, 'discord', ?, ?, 1)`,
    crypto.randomUUID(), eventId, discordUrl, host.id,
  );
  return { host, cohost, speaker, eventId };
}

/** 外へ出た送信（Resend のメール・Discord）。宛先と件名・題名だけ集める */
const emails: { to: string; subject: string }[] = [];
const hooks: string[] = [];

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock.get("https://api.resend.com").intercept({ path: "/emails", method: "POST" }).reply((opts) => {
    const body = JSON.parse(String(opts.body)) as { to: string[]; subject: string };
    emails.push({ to: body.to[0]!, subject: body.subject });
    return { statusCode: 200, data: "{}" };
  }).persist();
  fetchMock.get("https://discord.com").intercept({ path: () => true, method: "POST" }).reply((opts) => {
    const body = JSON.parse(String(opts.body)) as { embeds: { title?: string }[] };
    hooks.push(body.embeds[0]?.title ?? "");
    return { statusCode: 204, data: "" };
  }).persist();
});
afterEach(() => {
  emails.length = 0;
  hooks.length = 0;
});

/** 実行文脈つきで叩き、裏の送信（waitUntil）が終わるまで待つ */
async function call(path: string, u: Actor | null, method = "GET", body?: unknown): Promise<Response> {
  const { default: worker } = await import("../src/worker.js");
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${BASE}/api${path}`, {
      method,
      headers: { ...(u ? { cookie: u.cookie } : {}), "content-type": "application/json", origin: BASE },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { ...env, RESEND_API_KEY: "test", APP_BASE_URL: BASE } as never,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function contact(eventId: string, from: Actor, to: Actor, body = "登壇の資料を前日までに送ってください") {
  const res = await call(`/events/${eventId}/inquiries/staff-contact`, from, "POST", { userId: to.id, subject: "資料のお願い", body });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const notices = async (u: Actor) =>
  (await env.DB.prepare("SELECT type, title, link FROM notification WHERE user_id = ?").bind(u.id)
    .all<{ type: string; title: string; link: string }>()).results;

describe("運営から個別に連絡する", () => {
  it("相手にベル通知とメールが届き、Webhook には流れない。相手の一覧とスレッドに「運営から」で出る", async () => {
    const f = await fixture();
    const id = await contact(f.eventId, f.host, f.speaker);

    expect(await notices(f.speaker)).toEqual([
      { type: "event_inquiry_reply", title: "「連絡の検証」の運営から連絡が届きました", link: `/inquiries/${id}` },
    ]);
    expect(emails).toEqual([{ to: f.speaker.email, subject: "「連絡の検証」の運営から連絡が届きました" }]);
    expect(hooks).toEqual([]);
    // 送ったスタッフ・ほかのスタッフには何も届かない（自分たちが書いたもの）
    expect(await notices(f.cohost)).toEqual([]);

    const mine = ((await (await call("/inquiries", f.speaker)).json()) as { inquiries: Inquiry[] }).inquiries;
    expect(mine.find((q) => q.id === id)).toMatchObject({ startedByStaff: true, unread: true, event: { id: f.eventId } });
    const thread = (await (await call(`/inquiries/${id}`, f.speaker)).json()) as InquiryDetail;
    expect(thread.messages.map((m) => m.sender)).toEqual(["staff"]);

    // 運営の一覧にも並び、誰が送ったかが分かる
    const list = ((await (await call(`/events/${f.eventId}/inquiries`, f.cohost)).json()) as { inquiries: AdminInquiry[] }).inquiries;
    expect(list.find((q) => q.id === id)).toMatchObject({ startedByStaff: true, userId: f.speaker.id });
    const staffView = (await (await call(`/events/${f.eventId}/inquiries/${id}`, f.cohost)).json()) as InquiryDetail;
    expect(staffView.starterName).toBe(f.host.handle);
  });

  it("相手の返信は Webhook に流れ、メールは連絡を始めたスタッフだけに届く。ベルは運営全員", async () => {
    const f = await fixture();
    const id = await contact(f.eventId, f.host, f.speaker);
    emails.length = 0;

    expect((await call(`/inquiries/${id}/messages`, f.speaker, "POST", { body: "了解です。前日に送ります" })).status).toBe(200);
    expect(hooks).toEqual(["運営からの連絡への返信: 連絡の検証"]);
    expect(emails).toEqual([{ to: f.host.email, subject: "「連絡の検証」の運営からの連絡に返信がありました" }]);
    for (const staff of [f.host, f.cohost]) {
      expect(await notices(staff)).toEqual([
        { type: "event_inquiry_new", title: "「連絡の検証」の運営からの連絡に返信がありました", link: `/events/${f.eventId}/inquiries/${id}` },
      ]);
    }
    // 運営から始めた連絡は、本人の問い合わせの上限（未完了3件）に数えない
    for (let i = 0; i < 3; i++) await contact(f.eventId, f.cohost, f.speaker);
    expect((await call(`/events/${f.eventId}/inquiries`, f.speaker, "POST", { body: "質問です" })).status).toBe(201);
  });

  it("本人が始めた問い合わせは運営全員にメールが届き、運営の返信は本人にメールが届く", async () => {
    const f = await fixture();
    const res = await call(`/events/${f.eventId}/inquiries`, f.speaker, "POST", { subject: "駐車場", body: "駐車場はありますか？" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(emails.map((e) => e.to).sort()).toEqual([f.host.email, f.cohost.email].sort());
    expect(hooks).toEqual(["問い合わせ: 連絡の検証"]);

    emails.length = 0;
    hooks.length = 0;
    expect((await call(`/events/${f.eventId}/inquiries/${id}/messages`, f.cohost, "POST", { body: "あります" })).status).toBe(200);
    expect(emails).toEqual([{ to: f.speaker.email, subject: "主催者から返信がありました" }]);
    expect(hooks).toEqual([]);
  });

  it("送れるのは確定スタッフだけ。相手はそのイベントのメンバーで自分以外", async () => {
    const f = await fixture();
    const outsider = await user(), canceled = await user();
    await member(f.eventId, canceled, "participant", "canceled");
    const send = (from: Actor, to: Actor) =>
      call(`/events/${f.eventId}/inquiries/staff-contact`, from, "POST", { userId: to.id, body: "連絡です" });

    expect((await send(f.speaker, f.host)).status).toBe(403);
    expect((await send(f.host, f.host)).status).toBe(404);
    expect((await send(f.host, outsider)).status).toBe(404);
    expect((await send(f.host, canceled)).status).toBe(404);
    expect((await env.DB.prepare("SELECT COUNT(1) AS n FROM inquiry WHERE event_id = ?").bind(f.eventId).first<{ n: number }>())!.n).toBe(0);
    expect(emails).toEqual([]);
  });
});
