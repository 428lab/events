import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type {
  CheckinResult,
  CheckinTicket,
  MemberLookupResult,
} from "@eventer/shared";

const BASE = "https://example.com";
/** vitest.config.ts の bindings と同じ値（トークン偽造・期限切れの検証用） */
const SESSION_SECRET = "test-secret";

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 出席チェックモードの公開イベントを作る */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "QR受付E2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published", attendanceCheck: true }),
  });
  return event.id;
}

/** 非adminユーザーを1人作り、{ userId, username, cookie } を返す */
async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `u_${uid.slice(0, 6)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, username, cookie: `eventer_session=${sid}` };
}

/** 非adminのメンバーを1人作る */
async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  opts: { status?: string; attended?: 0 | 1 } = {},
): Promise<{ userId: string; username: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      u.userId,
      role,
      opts.status ?? "confirmed",
      opts.attended ?? 0,
      Date.now(),
    )
    .run();
  return u;
}

/** サーバーと同じ方式でチケットを作る（期限切れ・別イベント・非確定者のケース用） */
async function craftToken(
  eventId: string,
  userId: string,
  exp: number,
  secret = SESSION_SECRET,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`checkin:${eventId}:${userId}:${exp}`),
  );
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `evt1.${eventId}.${userId}.${exp}.${hex}`;
}

async function attendedInDb(eventId: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT attended FROM event_member WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ attended: number }>();
  return row?.attended ?? -1;
}

describe("QR受付: 入場チケット (#154)", () => {
  it("my-ticket: 確定メンバーは取得でき、非メンバー/キャンセル待ちは403", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const member = await makeMember(eventId, "participant");
    const outsider = await makeUser();
    const waitlist = await makeMember(eventId, "participant", {
      status: "waitlist",
    });

    const ok = await SELF.fetch(`${BASE}/api/events/${eventId}/my-ticket`, {
      headers: { cookie: member.cookie },
    });
    expect(ok.status).toBe(200);
    const ticket = (await ok.json()) as CheckinTicket;
    expect(ticket.token.startsWith(`evt1.${eventId}.${member.userId}.`)).toBe(
      true,
    );
    expect(ticket.expiresAt).toBeGreaterThan(Date.now());

    const denied = await SELF.fetch(`${BASE}/api/events/${eventId}/my-ticket`, {
      headers: { cookie: outsider.cookie },
    });
    expect(denied.status).toBe(403);

    const deniedWaitlist = await SELF.fetch(
      `${BASE}/api/events/${eventId}/my-ticket`,
      { headers: { cookie: waitlist.cookie } },
    );
    expect(deniedWaitlist.status).toBe(403);
  });

  it("checkin: 有効チケットで出席記録 → 2回目は already。participant は403", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const member = await makeMember(eventId, "participant");

    const ticketRes = await SELF.fetch(
      `${BASE}/api/events/${eventId}/my-ticket`,
      { headers: { cookie: member.cookie } },
    );
    const { token } = (await ticketRes.json()) as CheckinTicket;

    // staff 以外（participant 本人）は受付できない
    const forbidden = await SELF.fetch(
      `${BASE}/api/events/${eventId}/checkin`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: member.cookie },
        body: JSON.stringify({ token }),
      },
    );
    expect(forbidden.status).toBe(403);

    const first = await SELF.fetch(`${BASE}/api/events/${eventId}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ token }),
    });
    expect(first.status).toBe(200);
    const r1 = (await first.json()) as CheckinResult;
    expect(r1.result).toBe("checked_in");
    expect(r1.user.id).toBe(member.userId);
    expect(r1.member?.attended).toBe(true);
    expect(await attendedInDb(eventId, member.userId)).toBe(1);

    const second = await SELF.fetch(`${BASE}/api/events/${eventId}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ token }),
    });
    const r2 = (await second.json()) as CheckinResult;
    expect(second.status).toBe(200);
    expect(r2.result).toBe("already");
  });

  it("checkin: 期限切れは410、署名改ざんは400、別イベントのチケットは400", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const otherEventId = await setupEvent(admin);
    const member = await makeMember(eventId, "participant");

    // 期限切れ（exp が過去）
    const expired = await craftToken(
      eventId,
      member.userId,
      Math.floor(Date.now() / 1000) - 10,
    );
    const resExpired = await SELF.fetch(
      `${BASE}/api/events/${eventId}/checkin`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ token: expired }),
      },
    );
    expect(resExpired.status).toBe(410);

    // 署名改ざん（別の鍵で署名）
    const tampered = await craftToken(
      eventId,
      member.userId,
      Math.floor(Date.now() / 1000) + 100,
      "wrong-secret",
    );
    const resTampered = await SELF.fetch(
      `${BASE}/api/events/${eventId}/checkin`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ token: tampered }),
      },
    );
    expect(resTampered.status).toBe(400);

    // 別イベント宛のチケット（署名は正しい）
    const wrongEvent = await craftToken(
      eventId,
      member.userId,
      Math.floor(Date.now() / 1000) + 100,
    );
    const resWrong = await SELF.fetch(
      `${BASE}/api/events/${otherEventId}/checkin`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ token: wrongEvent }),
      },
    );
    expect(resWrong.status).toBe(400);
    // どちらのケースでも出席は記録されない
    expect(await attendedInDb(eventId, member.userId)).toBe(0);
  });

  it("checkin: 確定参加者でない対象は not_confirmed で出席記録しない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const waitlist = await makeMember(eventId, "participant", {
      status: "waitlist",
    });

    // 署名としては正当なチケットを直接作る（waitlist は my-ticket を取れないため）
    const token = await craftToken(
      eventId,
      waitlist.userId,
      Math.floor(Date.now() / 1000) + 100,
    );
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const r = (await res.json()) as CheckinResult;
    expect(r.result).toBe("not_confirmed");
    expect(await attendedInDb(eventId, waitlist.userId)).toBe(0);
  });
});

describe("QR受付: member-lookup (#154)", () => {
  it("staff 以外は403", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const participant = await makeMember(eventId, "participant");
    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/member-lookup?handle=${participant.username}`,
      { headers: { cookie: participant.cookie } },
    );
    expect(res.status).toBe(403);
  });

  it("username でメンバーを解決し attended 状態を返す。UUID でも解決できる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const attended = await makeMember(eventId, "participant", { attended: 1 });

    const byName = await SELF.fetch(
      `${BASE}/api/events/${eventId}/member-lookup?handle=${attended.username}`,
      { headers: { cookie: admin } },
    );
    expect(byName.status).toBe(200);
    const r1 = (await byName.json()) as MemberLookupResult;
    expect(r1.found).toBe(true);
    expect(r1.user?.id).toBe(attended.userId);
    expect(r1.member?.status).toBe("confirmed");
    expect(r1.member?.attended).toBe(true);

    const byId = await SELF.fetch(
      `${BASE}/api/events/${eventId}/member-lookup?handle=${attended.userId}`,
      { headers: { cookie: admin } },
    );
    expect(byId.status).toBe(200);
    const r2 = (await byId.json()) as MemberLookupResult;
    expect(r2.found).toBe(true);
    expect(r2.user?.id).toBe(attended.userId);
  });

  it("非メンバーは member:null、未知の handle は found:false", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const outsider = await makeUser();

    const nonMember = await SELF.fetch(
      `${BASE}/api/events/${eventId}/member-lookup?handle=${outsider.username}`,
      { headers: { cookie: admin } },
    );
    expect(nonMember.status).toBe(200);
    const r1 = (await nonMember.json()) as MemberLookupResult;
    expect(r1.found).toBe(true);
    expect(r1.member).toBeNull();

    const unknown = await SELF.fetch(
      `${BASE}/api/events/${eventId}/member-lookup?handle=no_such_user_xyz`,
      { headers: { cookie: admin } },
    );
    expect(unknown.status).toBe(200);
    const r2 = (await unknown.json()) as MemberLookupResult;
    expect(r2.found).toBe(false);

    // 不正な handle（記号など）はバリデーションエラー
    const invalid = await SELF.fetch(
      `${BASE}/api/events/${eventId}/member-lookup?handle=${encodeURIComponent("a b/c")}`,
      { headers: { cookie: admin } },
    );
    expect(invalid.status).toBe(400);
  });
});
