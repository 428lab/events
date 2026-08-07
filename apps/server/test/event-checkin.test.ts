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

describe("手動の出席チェック: 参加確定の人だけ (#286)", () => {
  /** PATCH /:id/members/:userId/attendance */
  const setAttendance = (
    eventId: string,
    userId: string,
    attended: boolean,
    cookie: string,
  ) =>
    SELF.fetch(`${BASE}/api/events/${eventId}/members/${userId}/attendance`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ attended }),
    });

  it("落選・抽選申込中・キャンセル待ちは出席にできない（409 not_confirmed）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    for (const status of ["lost", "applied", "waitlist"]) {
      const m = await makeMember(eventId, "participant", { status });
      const res = await setAttendance(eventId, m.userId, true, admin);
      expect(res.status, status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_confirmed" });
      // 記録も時刻も付いていない
      expect(await attendedInDb(eventId, m.userId), status).toBe(0);
      const row = await env.DB.prepare(
        "SELECT attended_at FROM event_member WHERE event_id = ? AND user_id = ?",
      )
        .bind(eventId, m.userId)
        .first<{ attended_at: number | null }>();
      expect(row?.attended_at, status).toBeNull();
    }
  });

  it("取消済みの人も出席にできない（メンバー扱いしないので404）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const m = await makeMember(eventId, "participant", { status: "canceled" });

    const res = await setAttendance(eventId, m.userId, true, admin);
    expect(res.status).toBe(404);
    expect(await attendedInDb(eventId, m.userId)).toBe(0);
  });

  it("参加確定の参加者・スタッフ・審査員・見学は出席にできる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    for (const role of ["participant", "staff", "judge", "observer"] as const) {
      const m = await makeMember(eventId, role);
      const res = await setAttendance(eventId, m.userId, true, admin);
      expect(res.status, role).toBe(200);
      const { member } = (await res.json()) as {
        member: { attended: boolean; attendedAt: number | null };
      };
      expect(member.attended, role).toBe(true);
      expect(member.attendedAt, role).not.toBeNull();
      expect(await attendedInDb(eventId, m.userId), role).toBe(1);
    }
  });

  it("ロール変更で参加確定になった人（#277）は出席にできる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    // 落選のままスタッフにする → setRole が確定に揃える
    const m = await makeMember(eventId, "participant", { status: "lost" });
    const promote = await SELF.fetch(
      `${BASE}/api/events/${eventId}/members/${m.userId}/role`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ role: "staff" }),
      },
    );
    expect(promote.status).toBe(200);

    const res = await setAttendance(eventId, m.userId, true, admin);
    expect(res.status).toBe(200);
    expect(await attendedInDb(eventId, m.userId)).toBe(1);
  });

  it("出席の解除は確定でなくても通す（誤操作や過去データを直せるように）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    // #286 以前に付いてしまった「落選なのに出席」の行を模す
    const m = await makeMember(eventId, "participant", {
      status: "lost",
      attended: 1,
    });

    const res = await setAttendance(eventId, m.userId, false, admin);
    expect(res.status).toBe(200);
    expect(await attendedInDb(eventId, m.userId)).toBe(0);
  });

  it("存在しないメンバーは404", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const outsider = await makeUser();

    const res = await setAttendance(eventId, outsider.userId, true, admin);
    expect(res.status).toBe(404);
  });

  it("staff 以外は出席を変更できない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const member = await makeMember(eventId, "participant");
    const other = await makeMember(eventId, "participant");

    const res = await setAttendance(
      eventId,
      other.userId,
      true,
      member.cookie,
    );
    expect(res.status).toBe(403);
    expect(await attendedInDb(eventId, other.userId)).toBe(0);
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

/** 参加枠つきイベントで使う補助（先着枠の繰り上げ経路の検証用） */
async function createSlot(
  eventId: string,
  cookie: string,
  capacity: number,
  selectionType: "first_come" | "lottery",
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "一般枠", capacity, selectionType }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { slot: { id: string } }).slot.id;
}

/** 参加申込。返るのは付いた参加状態（先着なら confirmed か waitlist） */
async function joinEvent(
  eventId: string,
  cookie: string,
  slotId: string,
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ slotId }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { status: string }).status;
}

/** PATCH /:id/slots/:slotId/members/:userId/status（申込者の参加状態の手動設定） */
async function setSlotStatus(
  eventId: string,
  slotId: string,
  userId: string,
  status: string,
  cookie: string,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/events/${eventId}/slots/${slotId}/members/${userId}/status`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status }),
    },
  );
}

async function attendanceRow(
  eventId: string,
  userId: string,
): Promise<{ status: string; attended: number; attended_at: number | null }> {
  const row = await env.DB.prepare(
    "SELECT status, attended, attended_at FROM event_member WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ status: string; attended: number; attended_at: number | null }>();
  expect(row).not.toBeNull();
  return row!;
}

const setAttendanceReq = (
  eventId: string,
  userId: string,
  attended: boolean,
  cookie: string,
) =>
  SELF.fetch(`${BASE}/api/events/${eventId}/members/${userId}/attendance`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ attended }),
  });

/** 先着枠のキャンセル待ちを当日その場で確定にする経路 (#286)。
 * waitlist は先着枠でしか発生しない。自動繰り上げが走らない場面（当日に人が
 * 来なかった・その場で1人増やす）でも staff が確定にできること。 */
describe("先着枠: キャンセル待ちを確定にして出席にできる (#286)", () => {
  it("キャンセル待ち → 参加確定 → 出席 まで通る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slotId = await createSlot(eventId, admin, 1, "first_come");

    const first = await makeUser();
    const second = await makeUser();
    expect(await joinEvent(eventId, first.cookie, slotId)).toBe("confirmed");
    // 定員1なので2人目はキャンセル待ち
    expect(await joinEvent(eventId, second.cookie, slotId)).toBe("waitlist");

    // キャンセル待ちのままでは出席にできない（#286 の検査）
    const tooEarly = await setAttendanceReq(eventId, second.userId, true, admin);
    expect(tooEarly.status).toBe(409);
    expect(await res409Error(tooEarly)).toBe("not_confirmed");

    // 先着枠でも参加状態を確定にできる（この画面が塞がっていた）
    const promote = await setSlotStatus(
      eventId,
      slotId,
      second.userId,
      "confirmed",
      admin,
    );
    expect(promote.status).toBe(200);
    expect((await attendanceRow(eventId, second.userId)).status).toBe("confirmed");

    const attend = await setAttendanceReq(eventId, second.userId, true, admin);
    expect(attend.status).toBe(200);
    const row = await attendanceRow(eventId, second.userId);
    expect(row.attended).toBe(1);
    expect(row.attended_at).not.toBeNull();
  });

  it("定員に空きが無くても確定にできる（当日の繰り上げを塞がない）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slotId = await createSlot(eventId, admin, 1, "first_come");

    const first = await makeUser();
    const second = await makeUser();
    await joinEvent(eventId, first.cookie, slotId);
    await joinEvent(eventId, second.cookie, slotId);

    // 1人目を確定のままにして2人目も確定にする＝定員1に対して確定2人
    const res = await setSlotStatus(
      eventId,
      slotId,
      second.userId,
      "confirmed",
      admin,
    );
    expect(res.status).toBe(200);

    const slots = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
      headers: { cookie: admin },
    });
    const { slots: list } = (await slots.json()) as {
      slots: Array<{ id: string; capacity: number; confirmedCount: number }>;
    };
    const slot = list.find((s) => s.id === slotId)!;
    // 超過はサーバーでは拒否しない。画面側が「定員超過」として見せる
    expect(slot.capacity).toBe(1);
    expect(slot.confirmedCount).toBe(2);
  });
});

async function res409Error(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: string }).error;
}

/** 参加確定でなくなったら出席も落とす (#286)。
 * 0063 が消したのと同じ行を、確定→出席→落選 の順で作り直せてはいけない。 */
describe("参加状態を確定から戻すと出席記録も落ちる (#286)", () => {
  it.each([
    ["lost", "抽選枠を落選に戻す"],
    ["waitlist", "先着枠をキャンセル待ちに戻す"],
    ["applied", "抽選の申込中に戻す"],
  ])("%s にすると attended が落ちる", async (status) => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slotId = await createSlot(eventId, admin, 5, "lottery");
    const u = await makeUser();
    await joinEvent(eventId, u.cookie, slotId);

    expect(
      (await setSlotStatus(eventId, slotId, u.userId, "confirmed", admin))
        .status,
    ).toBe(200);
    expect((await setAttendanceReq(eventId, u.userId, true, admin)).status).toBe(
      200,
    );
    expect((await attendanceRow(eventId, u.userId)).attended).toBe(1);

    expect(
      (await setSlotStatus(eventId, slotId, u.userId, status, admin)).status,
    ).toBe(200);

    const row = await attendanceRow(eventId, u.userId);
    expect(row).toEqual({ status, attended: 0, attended_at: null });
  });

  it("抽選の実行でも、落選になった人の出席は落ちる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slotId = await createSlot(eventId, admin, 1, "lottery");
    const u = await makeUser();
    await joinEvent(eventId, u.cookie, slotId);
    // 一度確定＋出席にしてから申込中に戻し、抽選（定員0埋まり）で落選させる
    await setSlotStatus(eventId, slotId, u.userId, "confirmed", admin);
    await setAttendanceReq(eventId, u.userId, true, admin);
    await env.DB.prepare(
      "UPDATE event_member SET status = 'applied' WHERE event_id = ? AND user_id = ?",
    )
      .bind(eventId, u.userId)
      .run();
    // 当選枠を0にして必ず落選させる（抽選のランダム性を検証から外す）
    await env.DB.prepare("UPDATE participation_slot SET capacity = 0 WHERE id = ?")
      .bind(slotId)
      .run();

    const draw = await SELF.fetch(
      `${BASE}/api/events/${eventId}/slots/${slotId}/draw`,
      { method: "POST", headers: { cookie: admin } },
    );
    expect(draw.status).toBe(200);

    const row = await attendanceRow(eventId, u.userId);
    expect(row.status).toBe("lost");
    expect(row.attended).toBe(0);
    expect(row.attended_at).toBeNull();
  });
});

/** 0063 の WHERE 句が拾う行・拾わない行 (#286)。
 * 適用済みのマイグレーションと同じ SQL を、実データ相当の行に当て直して確かめる
 * （空DBに当たるだけでは UPDATE 系は原理的に未検証になるため / 0061 と同じ作法）。 */
describe("0063 マイグレーションの対象行", () => {
  it("参加確定でない出席記録だけを消し、確定と取消済みは触らない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    // [status, attended] と、適用後に期待する [attended, attended_at が残るか]
    const cases: Array<[string, 0 | 1, 0 | 1, boolean]> = [
      // 参加枠を得ていない出席記録は消す
      ["lost", 1, 0, false],
      ["applied", 1, 0, false],
      ["waitlist", 1, 0, false],
      // 参加確定の出席はそのまま（集計を動かさない）
      ["confirmed", 1, 1, true],
      // 取消済みは参加履歴として残す (0061 と同じ方針)
      ["canceled", 1, 1, true],
      // 元から出席でない行は触らない
      ["lost", 0, 0, false],
      ["confirmed", 0, 0, false],
    ];
    const users: string[] = [];
    for (const [status, attended] of cases) {
      const u = await makeUser();
      users.push(u.userId);
      await env.DB.prepare(
        "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, attended_at, created_at) VALUES (?, ?, ?, 'participant', NULL, ?, ?, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          eventId,
          u.userId,
          status,
          attended,
          attended ? 1_700_000_000_000 : null,
          Date.now(),
        )
        .run();
    }

    const migration = env.TEST_MIGRATIONS.find((m) =>
      m.name.startsWith("0063_"),
    );
    expect(migration).toBeDefined();
    for (const sql of migration!.queries) {
      await env.DB.prepare(sql).run();
    }

    for (const [i, [status, before, attended, keepsAt]] of cases.entries()) {
      const row = await attendanceRow(eventId, users[i]);
      expect({ status, before, ...row }).toEqual({
        status,
        before,
        attended,
        attended_at: keepsAt ? 1_700_000_000_000 : null,
      });
    }
  });
});
