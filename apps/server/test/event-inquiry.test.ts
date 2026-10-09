import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { AdminInquiry, Inquiry, InquiryDetail } from "@eventer/shared";
import { EVENT_INQUIRY_OPEN_LIMIT } from "@eventer/shared";

/**
 * イベントの主催者への問い合わせ (D-EVENT-CONTACT)。
 *
 * 守ること:
 * 1. 送れるのは、そのイベントを見られるログイン中の人（参加していなくてよい）。
 *    非公開イベントを見られない人には、存在しないイベントと同じ 404
 * 2. 主催者側（一覧・詳細・返信・完了）は、そのイベントの確定スタッフだけ。
 *    アプリ運営管理者も、スタッフでなければ 403。運営の問い合わせ画面にも出ない
 * 3. 1人が1つのイベントへ出せる未完了の問い合わせは3件まで（429）
 * 4. 届いたらスタッフ全員に、返信したら問い合わせた人にベル通知。運営には知らせない
 * 5. スタッフの返信は、問い合わせた人の /api/inquiries から見える
 */

const BASE = "https://example.com";
const DAY = 86_400_000;

type Actor = { id: string; cookie: string; discordId: string };

const sql = (q: string, ...v: unknown[]) => env.DB.prepare(q).bind(...v).run();

/** admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる */
async function user(admin = false): Promise<Actor> {
  const id = crypto.randomUUID();
  const sid = crypto.randomUUID();
  // ADMIN_DISCORD_IDS は1つなので、管理者は既存の dev-user 行を使い回す
  if (admin) {
    const row = await env.DB.prepare("SELECT id FROM user WHERE discord_id = 'dev-user'").first<{ id: string }>();
    const adminId = row?.id ?? id;
    if (!row) await sql("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, 'dev-user', ?, 1)", adminId, `admin_${id.slice(0, 8)}`);
    await sql("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)", sid, adminId, Date.now() + DAY);
    return { id: adminId, cookie: `eventer_session=${sid}`, discordId: "dev-user" };
  }
  await sql("INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, 1)", id, `test:${id}`, `u_${id.slice(0, 8)}`);
  await sql("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)", sid, id, Date.now() + DAY);
  return { id, cookie: `eventer_session=${sid}`, discordId: `test:${id}` };
}

async function event(owner: Actor, visibility: "public" | "unlisted" | "private" = "public"): Promise<string> {
  const id = crypto.randomUUID();
  await sql(
    `INSERT INTO event (id, slug, title, created_by, created_at, starts_at, ends_at, venue_type, status, visibility)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'online', 'published', ?)`,
    id, id.slice(0, 8), `問い合わせ検証_${id.slice(0, 6)}`, owner.id, Date.now() + DAY, Date.now() + 2 * DAY, visibility,
  );
  await member(id, owner, "staff");
  return id;
}

async function member(eventId: string, u: Actor, role: string, status = "confirmed") {
  await sql(
    `INSERT INTO event_member (id, event_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(event_id, user_id) DO UPDATE SET role = excluded.role, status = excluded.status`,
    crypto.randomUUID(), eventId, u.id, role, status,
  );
}

async function grant(eventId: string, u: Actor) {
  await sql(
    "INSERT INTO event_access_invite (id, event_id, user_id, status, source, created_at) VALUES (?, ?, ?, 'accepted', 'invite', 1)",
    crypto.randomUUID(), eventId, u.id,
  );
}

function req(path: string, u: Actor | null, method = "GET", body?: unknown) {
  return SELF.fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(u ? { cookie: u.cookie } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function ask(eventId: string, u: Actor, body = "駐車場はありますか？", subject = ""): Promise<string> {
  const res = await req(`/events/${eventId}/inquiries`, u, "POST", { subject, body });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function notices(u: Actor, type: string) {
  const rows = await env.DB.prepare("SELECT title, body, link FROM notification WHERE user_id = ? AND type = ?")
    .bind(u.id, type).all<{ title: string; body: string; link: string }>();
  return rows.results;
}

describe("送る口 (D-EVENT-CONTACT)", () => {
  it("公開イベントは、参加していないログイン中の人でも送れる。未ログインは 401", async () => {
    const owner = await user();
    const asker = await user();
    const eventId = await event(owner);
    const id = await ask(eventId, asker, "参加費はいくらですか？", "参加費");
    const list = (await (await req("/inquiries", asker)).json()) as { inquiries: Inquiry[] };
    const mine = list.inquiries.find((q) => q.id === id)!;
    expect(mine.event).toMatchObject({ id: eventId });
    expect(mine.status).toBe("open");
    expect((await req(`/events/${eventId}/inquiries`, null, "POST", { body: "x" })).status).toBe(401);
  });

  it("非公開イベントを見られない人には、存在しないイベントと同じ 404。招待された人は送れる", async () => {
    const owner = await user();
    const outsider = await user();
    const invited = await user();
    const eventId = await event(owner, "private");
    await grant(eventId, invited);
    const denied = await req(`/events/${eventId}/inquiries`, outsider, "POST", { body: "秘密ですか？" });
    const missing = await req(`/events/${crypto.randomUUID()}/inquiries`, outsider, "POST", { body: "秘密ですか？" });
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await denied.json()).toEqual(await missing.json());
    expect((await env.DB.prepare("SELECT COUNT(1) AS n FROM inquiry WHERE event_id = ?").bind(eventId).first<{ n: number }>())!.n).toBe(0);
    await ask(eventId, invited);
  });

  it(`未完了は1人1イベント ${EVENT_INQUIRY_OPEN_LIMIT} 件まで。完了にすると、また送れる`, async () => {
    const owner = await user();
    const asker = await user();
    const eventId = await event(owner);
    const ids: string[] = [];
    for (let i = 0; i < EVENT_INQUIRY_OPEN_LIMIT; i++) ids.push(await ask(eventId, asker));
    const over = await req(`/events/${eventId}/inquiries`, asker, "POST", { body: "もう1件" });
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "event_inquiry_limit", limit: EVENT_INQUIRY_OPEN_LIMIT });
    // 別のイベントには数えない
    await ask(await event(owner), asker);
    expect((await req(`/events/${eventId}/inquiries/${ids[0]}/close`, owner, "POST")).status).toBe(200);
    await ask(eventId, asker);
  });
});

describe("主催者側の口は、そのイベントの確定スタッフだけ (D-EVENT-CONTACT)", () => {
  it("参加者・未確定のスタッフ・ほかのイベントのスタッフ・アプリ管理者は 403", async () => {
    const owner = await user();
    const asker = await user();
    const eventId = await event(owner);
    const id = await ask(eventId, asker);
    const participant = await user();
    await member(eventId, participant, "participant");
    const pendingStaff = await user();
    await member(eventId, pendingStaff, "staff", "pending");
    const otherOwner = await user();
    await event(otherOwner);
    const admin = await user(true);
    for (const who of [participant, pendingStaff, otherOwner, admin, asker]) {
      for (const [method, path, body] of [
        ["GET", `/events/${eventId}/inquiries`],
        ["GET", `/events/${eventId}/inquiries/unread-count`],
        ["GET", `/events/${eventId}/inquiries/${id}`],
        ["POST", `/events/${eventId}/inquiries/${id}/messages`, { body: "返事" }],
        ["POST", `/events/${eventId}/inquiries/${id}/close`],
      ] as Array<[string, string, unknown?]>) {
        const res = await req(path, who, method, body);
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(await res.json()).toEqual({ error: "forbidden" });
      }
    }
    // 何も書かれていない
    const detail = (await (await req(`/inquiries/${id}`, asker)).json()) as InquiryDetail;
    expect(detail.messages).toHaveLength(1);
    expect(detail.status).toBe("open");
  });

  it("ほかのイベントの問い合わせには、自分のイベントの口から届かない", async () => {
    const owner = await user();
    const otherOwner = await user();
    const asker = await user();
    const eventId = await event(owner);
    const otherEvent = await event(otherOwner);
    const id = await ask(otherEvent, asker);
    expect((await req(`/events/${eventId}/inquiries/${id}`, owner)).status).toBe(404);
    expect((await req(`/events/${eventId}/inquiries/${id}/messages`, owner, "POST", { body: "x" })).status).toBe(404);
    expect((await req(`/events/${eventId}/inquiries/${id}/close`, owner, "POST")).status).toBe(404);
    const list = (await (await req(`/events/${eventId}/inquiries`, owner)).json()) as { inquiries: AdminInquiry[] };
    expect(list.inquiries.map((q) => q.id)).not.toContain(id);
  });

  it("アプリ運営の問い合わせ画面には、イベントの問い合わせが出ない", async () => {
    const owner = await user();
    const asker = await user();
    const admin = await user(true);
    const eventId = await event(owner);
    const id = await ask(eventId, asker);
    // 返信で未読にしても、運営の未読数に数えない
    await req(`/inquiries/${id}/messages`, asker, "POST", { body: "追伸" });
    const list = (await (await req("/admin/inquiries", admin)).json()) as { inquiries: AdminInquiry[] };
    expect(list.inquiries.map((q) => q.id)).not.toContain(id);
    expect((await req(`/admin/inquiries/${id}`, admin)).status).toBe(404);
    expect((await req(`/admin/inquiries/${id}/messages`, admin, "POST", { body: "運営です" })).status).toBe(404);
    const unread = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM inquiry WHERE event_id IS NULL AND last_sender = 'user' AND last_message_at > admin_read_at",
    ).first<{ n: number }>();
    expect(((await (await req("/admin/inquiries/unread-count", admin)).json()) as { count: number }).count).toBe(unread!.n);
    // 運営には通知しない
    expect((await notices(admin, "inquiry_new")).filter((n) => n.link.includes(id))).toEqual([]);
  });
});

describe("やりとりと通知 (D-EVENT-CONTACT)", () => {
  it("届くと確定スタッフ全員に通知。返信は問い合わせた人の画面に出て、通知も届く", async () => {
    const owner = await user();
    const coStaff = await user();
    const participant = await user();
    const asker = await user();
    const eventId = await event(owner);
    await member(eventId, coStaff, "staff");
    await member(eventId, participant, "participant");
    const id = await ask(eventId, asker, "当日券はありますか？", "当日券");

    for (const staff of [owner, coStaff]) {
      const got = await notices(staff, "event_inquiry_new");
      expect(got).toHaveLength(1);
      expect(got[0]!.link).toBe(`/events/${eventId}/inquiries/${id}`);
      expect(got[0]!.body).toBe("「当日券」");
    }
    expect(await notices(participant, "event_inquiry_new")).toEqual([]);
    expect(await notices(asker, "event_inquiry_new")).toEqual([]);

    // 主催者側の一覧と未読
    const unread = (await (await req(`/events/${eventId}/inquiries/unread-count`, coStaff)).json()) as { count: number };
    expect(unread.count).toBe(1);
    const list = (await (await req(`/events/${eventId}/inquiries`, coStaff)).json()) as { inquiries: AdminInquiry[] };
    expect(list.inquiries).toHaveLength(1);
    expect(list.inquiries[0]).toMatchObject({ id, userId: asker.id, unread: true, subject: "当日券" });

    // 共同スタッフが返信
    const reply = await req(`/events/${eventId}/inquiries/${id}/messages`, coStaff, "POST", { body: "あります" });
    expect(reply.status).toBe(200);
    const replied = await notices(asker, "event_inquiry_reply");
    expect(replied).toHaveLength(1);
    expect(replied[0]!.link).toBe(`/inquiries/${id}`);
    const author = await env.DB.prepare("SELECT author_id FROM inquiry_message WHERE inquiry_id = ? AND sender = 'staff'")
      .bind(id).first<{ author_id: string }>();
    expect(author!.author_id).toBe(coStaff.id);

    // 問い合わせた人の側
    const mine = (await (await req("/inquiries", asker)).json()) as { inquiries: Inquiry[] };
    expect(mine.inquiries.find((q) => q.id === id)).toMatchObject({ status: "answered", lastSender: "staff", unread: true });
    expect(((await (await req("/inquiries/unread-count", asker)).json()) as { count: number }).count).toBe(1);
    const detail = (await (await req(`/inquiries/${id}`, asker)).json()) as InquiryDetail;
    expect(detail.messages.map((m) => [m.sender, m.body])).toEqual([["user", "当日券はありますか？"], ["staff", "あります"]]);
    expect(detail.event).toMatchObject({ id: eventId });
    expect(((await (await req("/inquiries/unread-count", asker)).json()) as { count: number }).count).toBe(0);

    // 完了 → 問い合わせた人が書き込むと対応中に戻り、スタッフへまた通知
    expect((await req(`/events/${eventId}/inquiries/${id}/close`, owner, "POST")).status).toBe(200);
    expect(((await (await req(`/inquiries/${id}`, asker)).json()) as InquiryDetail).status).toBe("closed");
    expect((await req(`/inquiries/${id}/messages`, asker, "POST", { body: "ありがとう" })).status).toBe(200);
    expect(((await (await req(`/events/${eventId}/inquiries/${id}`, owner)).json()) as InquiryDetail).status).toBe("open");
    expect(await notices(owner, "event_inquiry_new")).toHaveLength(2);
  });

  it("非公開イベントの通知は中立の文言。閲覧を外された人には、問い合わせも返信の通知も見えない", async () => {
    const owner = await user();
    const asker = await user();
    const eventId = await event(owner, "private");
    await grant(eventId, asker);
    const id = await ask(eventId, asker, "秘密の会場はどこ？", "会場");
    const staffNotice = await notices(owner, "event_inquiry_new");
    expect(staffNotice).toEqual([{ title: "イベントの更新があります", body: "", link: `/events/${eventId}` }]);

    await req(`/events/${eventId}/inquiries/${id}/messages`, owner, "POST", { body: "渋谷です" });
    expect(await notices(asker, "event_inquiry_reply")).toEqual([{ title: "イベントの更新があります", body: "", link: `/events/${eventId}` }]);

    // 閲覧を外す
    await sql("DELETE FROM event_access_invite WHERE event_id = ? AND user_id = ?", eventId, asker.id);
    const list = (await (await req("/inquiries", asker)).json()) as { inquiries: Inquiry[] };
    expect(list.inquiries.map((q) => q.id)).not.toContain(id);
    expect((await req(`/inquiries/${id}`, asker)).status).toBe(404);
    expect((await req(`/inquiries/${id}/messages`, asker, "POST", { body: "まだ？" })).status).toBe(404);
    expect(((await (await req("/inquiries/unread-count", asker)).json()) as { count: number }).count).toBe(0);
    await req(`/events/${eventId}/inquiries/${id}/messages`, owner, "POST", { body: "見えない返事" });
    const bell = (await (await req("/notifications", asker)).json()) as { notifications: Array<{ type: string }> };
    expect(bell.notifications.filter((n) => n.type === "event_inquiry_reply")).toEqual([]);
  });

  it("限定公開イベントに問い合わせた参加していない人にも、返信の通知が届く", async () => {
    const owner = await user();
    const asker = await user();
    const eventId = await event(owner, "unlisted");
    const id = await ask(eventId, asker);
    await req(`/events/${eventId}/inquiries/${id}/messages`, owner, "POST", { body: "はい" });
    const bell = (await (await req("/notifications", asker)).json()) as { notifications: Array<{ type: string; link: string }> };
    expect(bell.notifications.filter((n) => n.type === "event_inquiry_reply").map((n) => n.link)).toEqual([`/inquiries/${id}`]);
  });

  it("運営あての問い合わせは今までどおり（event は null、運営に通知）", async () => {
    const asker = await user();
    const admin = await user(true);
    const res = await req("/inquiries", asker, "POST", { subject: "退会したい", body: "方法は？" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const detail = (await (await req(`/inquiries/${id}`, asker)).json()) as InquiryDetail;
    expect(detail.event).toBeNull();
    const list = (await (await req("/admin/inquiries", admin)).json()) as { inquiries: AdminInquiry[] };
    expect(list.inquiries.find((q) => q.id === id)).toMatchObject({ event: null });
    expect((await notices(admin, "inquiry_new")).some((n) => n.link === `/admin/inquiries/${id}`)).toBe(true);
  });
});
