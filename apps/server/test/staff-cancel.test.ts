import { SELF, env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * 運営が参加者を「キャンセル扱い」にする（docs/attendance-staff-cancel.md）。
 * 当日・開始後に「行けない」と連絡があった人を、無断欠席ではなく直前キャンセルとして残す。
 */

const BASE = "https://example.com";
type U = { userId: string; username: string; cookie: string };

async function makeUser(): Promise<U> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `sc_${uid.slice(0, 6)}`;
  await env.DB.prepare("INSERT INTO user (id, discord_id, username, global_name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uid, `nostr:${uid}`, username, "参加者", Date.now()).run();
  await env.DB.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, uid, Date.now() + 86400000).run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

function call(path: string, u: U | null, method = "GET", body?: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { ...(u ? { cookie: u.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** 出席チェックありの公開イベントを作り、作成者（運営）を返す。開始・終了は後から DB で動かす */
async function makeEvent(host: U): Promise<string> {
  const res = await call("/api/events", host, "POST", {
    title: "キャンセル扱いの検証",
    venueType: "online",
    startsAt: Date.now() + 3600_000,
    endsAt: Date.now() + 7200_000,
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { event: { id: string } }).event.id;
  expect((await call(`/api/events/${id}`, host, "PATCH", { attendanceCheck: true })).status).toBe(200);
  expect((await call(`/api/events/${id}/publish`, host, "POST")).status).toBe(200);
  return id;
}

/** イベントを終わったことにする（開始2時間前〜1時間前） */
async function endEvent(eventId: string) {
  await env.DB.prepare("UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?")
    .bind(Date.now() - 2 * 3600_000, Date.now() - 3600_000, eventId).run();
}

async function stats(username: string) {
  const res = await call(`/api/public/users/${username}`, null);
  expect(res.status).toBe(200);
  return ((await res.json()) as { participation: { noShow: number; cancelLate: number; cancelEarly: number } }).participation;
}

const received: string[] = [];
const hook = `https://discord.com/api/webhooks/987654/${"s".repeat(30)}`;
beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock.get("https://discord.com")
    .intercept({ path: () => true, method: "POST" })
    .reply((opts) => {
      received.push(String(opts.body));
      return { statusCode: 204, data: "" };
    })
    .persist();
});
afterEach(() => { received.length = 0; });

describe("運営による「キャンセル扱い」", () => {
  it("終了後でもキャンセル扱いにでき、無断欠席ではなく直前キャンセルになる。本人に通知・監査ログ・Webhook が1回", async () => {
    const host = await makeUser();
    const p = await makeUser();
    const eventId = await makeEvent(host);
    expect((await call(`/api/events/${eventId}/webhooks`, host, "POST", { url: hook })).status).toBe(201);
    expect((await call(`/api/events/${eventId}/join`, p, "POST", {})).status).toBe(201);
    received.length = 0;
    await endEvent(eventId);
    expect((await stats(p.username)).noShow).toBe(1);

    const res = await call(`/api/events/${eventId}/members/${p.userId}/cancel`, host, "POST");
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT status FROM event_member WHERE event_id = ? AND user_id = ?").bind(eventId, p.userId).first<{ status: string }>();
    expect(row!.status).toBe("canceled");
    const s = await stats(p.username);
    expect(s.noShow).toBe(0);
    expect(s.cancelLate).toBe(1);

    const notice = await env.DB.prepare("SELECT title FROM notification WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(p.userId).first<{ title: string }>();
    expect(notice!.title).toBe("運営があなたの参加をキャンセル扱いにしました");
    const audit = await env.DB.prepare("SELECT actor_user_id, target_user_id FROM audit_log WHERE action = 'participation_cancel_by_staff' AND target_user_id = ?").bind(p.userId).first<{ actor_user_id: string }>();
    expect(audit!.actor_user_id).toBe(host.userId);

    for (let i = 0; i < 50 && received.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("キャンセル（運営が記録）");

    // もう一度押しても二重に記録しない
    expect((await call(`/api/events/${eventId}/members/${p.userId}/cancel`, host, "POST")).status).toBe(409);
  });

  it("運営でない人は 403。受付でチェックイン済みの人は来ていたので 409 already_attended", async () => {
    const host = await makeUser();
    const p = await makeUser();
    const other = await makeUser();
    const eventId = await makeEvent(host);
    expect((await call(`/api/events/${eventId}/join`, p, "POST", {})).status).toBe(201);
    expect((await call(`/api/events/${eventId}/join`, other, "POST", {})).status).toBe(201);
    expect((await call(`/api/events/${eventId}/members/${p.userId}/cancel`, other, "POST")).status).toBe(403);

    expect((await call(`/api/events/${eventId}/members/${p.userId}/attendance`, host, "PATCH", { attended: true })).status).toBe(200);
    const res = await call(`/api/events/${eventId}/members/${p.userId}/cancel`, host, "POST");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_attended");
    const row = await env.DB.prepare("SELECT status FROM event_member WHERE event_id = ? AND user_id = ?").bind(eventId, p.userId).first<{ status: string }>();
    expect(row!.status).toBe("confirmed");
  });

  it("終了前は本人の取り消しと同じく、先着枠のキャンセル待ちを繰り上げる", async () => {
    const host = await makeUser();
    const p = await makeUser();
    const waiting = await makeUser();
    const eventId = await makeEvent(host);
    const slotRes = await call(`/api/events/${eventId}/slots`, host, "POST", { name: "席", capacity: 1, selectionType: "first_come" });
    expect(slotRes.status).toBe(201);
    const slotId = ((await slotRes.json()) as { slot: { id: string } }).slot.id;
    expect((await call(`/api/events/${eventId}/join`, p, "POST", { slotId })).status).toBe(201);
    expect((await call(`/api/events/${eventId}/join`, waiting, "POST", { slotId })).status).toBe(201);

    expect((await call(`/api/events/${eventId}/members/${p.userId}/cancel`, host, "POST")).status).toBe(200);
    const row = await env.DB.prepare("SELECT status FROM event_member WHERE event_id = ? AND user_id = ?").bind(eventId, waiting.userId).first<{ status: string }>();
    expect(row!.status).toBe("confirmed");
  });
});
