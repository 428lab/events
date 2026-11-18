import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindEnv } from "../src/runtime.js";
import { notificationsRepo } from "../src/db/repositories/notifications.js";
import { drawMemberSlots } from "../src/db/repositories/memberSlotResults.js";
import { localized } from "../src/lib/noticeText.js";

/**
 * お知らせとメールを受け取る人の言語で送る (#352)。オーナー決定 2026-11-19（案 A）:
 * 最後に使った画面の言語で送る。設定で選んだ言語があればそちらが優先。分からない人は日本語。
 */

const BASE = "https://example.com/api";
const sql = (q: string, ...v: unknown[]) => env.DB.prepare(q).bind(...v).run();

async function user(language: string | null = null) {
  const id = crypto.randomUUID(), sid = crypto.randomUUID(), handle = `u_${id.slice(0, 8)}`;
  await sql("INSERT INTO user(id,discord_id,username,created_at,language) VALUES(?,?,?,?,?)", id, id, handle, Date.now(), language);
  await sql("INSERT INTO session(id,user_id,expires_at) VALUES(?,?,?)", sid, id, Date.now() + 86400000);
  return { id, handle, cookie: `eventer_session=${sid}` };
}
type Actor = Awaited<ReturnType<typeof user>>;
const call = (path: string, actor: Actor, method = "GET", body?: unknown) =>
  SELF.fetch(BASE + path, {
    method,
    headers: { cookie: actor.cookie, "content-type": "application/json", origin: "https://example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const titles = async (userId: string) =>
  (await env.DB.prepare("SELECT type,title,body FROM notification WHERE user_id=? ORDER BY created_at")
    .bind(userId).all<{ type: string; title: string; body: string }>()).results;
const languageOf = async (userId: string) =>
  env.DB.prepare("SELECT language,language_explicit FROM user WHERE id=?").bind(userId)
    .first<{ language: string | null; language_explicit: number }>();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("お知らせの言語 (#352)", () => {
  it("同じお知らせを、英語の人には英語、日本語と未設定の人には日本語で作る（イベント名は訳さない）", async () => {
    bindEnv(env as never);
    const en = await user("en"), ja = await user("ja"), unknown = await user(null);
    await notificationsRepo.createForMany(
      [en.id, ja.id, unknown.id],
      "award",
      localized("awardTitle"),
      localized("awardBody", { event: "春のハッカソン", award: "最優秀賞" }),
    );
    expect(await titles(en.id)).toEqual([
      { type: "award", title: "Congratulations on your award 🎉", body: "You received 最優秀賞 at \"春のハッカソン\"" },
    ]);
    for (const u of [ja, unknown]) {
      expect(await titles(u.id)).toEqual([
        { type: "award", title: "受賞おめでとうございます🎉", body: "「春のハッカソン」で最優秀賞を受賞しました" },
      ]);
    }
  });

  it("運営への招待（API 経由）は招かれた人の言語で届く", async () => {
    bindEnv(env as never);
    const host = await user("ja"), guest = await user("en");
    const created = await call("/events", host, "POST", {
      title: "Night Meetup", startsAt: Date.now() + 86400000, endsAt: Date.now() + 90000000, venueType: "online",
    });
    expect(created.status).toBe(201);
    const { event } = (await created.json()) as { event: { id: string } };
    const res = await call(`/events/${event.id}/staff-invites`, host, "POST", { handle: guest.handle });
    expect(res.status).toBe(201);
    const [notice] = await titles(guest.id);
    expect(notice).toMatchObject({ type: "staff_invite", title: "You have been invited to organize \"Night Meetup\"" });
  });

  it("SQL の中で作るお知らせ（抽選の結果）も宛先の言語", async () => {
    bindEnv(env as never);
    const host = await user("ja"), en = await user("en"), ja = await user(null);
    const created = await call("/events", host, "POST", {
      title: "Lottery Night", startsAt: Date.now() + 86400000, endsAt: Date.now() + 90000000, venueType: "online",
    });
    const { event } = (await created.json()) as { event: { id: string } };
    await sql("UPDATE event SET status='published' WHERE id=?", event.id);
    const slot = await call(`/events/${event.id}/slots`, host, "POST", { name: "Seat", capacity: 1, selectionType: "lottery" });
    const slotId = ((await slot.json()) as { slot: { id: string } }).slot.id;
    const members: string[] = [];
    for (const u of [en, ja]) {
      const joined = await call(`/events/${event.id}/join`, u, "POST", { slotId });
      expect(joined.status).toBe(201);
      members.push(((await joined.json()) as { member: { id: string } }).member.id);
    }
    expect(await drawMemberSlots(event.id, host.id, slotId, members)).toMatchObject({ drawn: 2, confirmed: 1, lost: 1 });
    expect(await titles(en.id)).toEqual([
      { type: "lottery_won", title: "You won the lottery", body: "You won the lottery for \"Lottery Night\". Your place is confirmed" },
    ]);
    expect(await titles(ja.id)).toEqual([
      { type: "lottery_lost", title: "抽選結果のお知らせ", body: "「Lottery Night」は今回は落選となりました" },
    ]);
  });

  it("通知メールの件名と枠の文言も宛先の言語", async () => {
    bindEnv({ ...env, RESEND_API_KEY: "test" } as never);
    const en = await user("en");
    await sql("INSERT INTO identity(id,user_id,provider,provider_user_id,email,created_at) VALUES(?,?,'google',?,'en@example.com',1)", crypto.randomUUID(), en.id, en.id);
    const send = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", send);
    await notificationsRepo.create(en.id, "info", localized("venueAdminTitle"), localized("venueAdminBody", { venue: "Hall A" }), "/venues/x");
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0]![1].body as string) as { subject: string; html: string };
    expect(payload.subject).toBe("You are now a venue manager 🏟️");
    expect(payload.html).toContain("View details");
    expect(payload.html).toContain("Turn off email notifications");
    expect(payload.html).not.toContain("詳細を見る");
  });
});

describe("言語を覚える PUT /api/me/language (#352)", () => {
  it("画面からの報告は覚えるが、設定で選んだ言語は報告で上書きしない。「自動」で選んだ印が外れる", async () => {
    const u = await user(null);
    const put = (language: string, mode: string) => call("/me/language", u, "PUT", { language, mode });

    expect((await put("en", "report")).status).toBe(200);
    expect(await languageOf(u.id)).toEqual({ language: "en", language_explicit: 0 });

    expect((await put("ja", "choose")).status).toBe(200);
    expect(await languageOf(u.id)).toEqual({ language: "ja", language_explicit: 1 });

    // 英語のブラウザで開いても、設定で選んだ日本語のまま
    const res = await put("en", "report");
    expect(await res.json()).toEqual({ noticeLanguage: { language: "ja", explicit: true } });
    expect(await languageOf(u.id)).toEqual({ language: "ja", language_explicit: 1 });

    expect((await put("en", "auto")).status).toBe(200);
    expect(await languageOf(u.id)).toEqual({ language: "en", language_explicit: 0 });

    // /auth/me で画面に今の値を返す
    const me = (await (await call("/auth/me", u)).json()) as { noticeLanguage: unknown };
    expect(me.noticeLanguage).toEqual({ language: "en", explicit: false });

    expect((await put("zh", "report")).status).toBe(400);
  });
});
