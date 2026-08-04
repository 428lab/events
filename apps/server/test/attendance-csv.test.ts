import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { CheckinTicket } from "@eventer/shared";

const BASE = "https://example.com";

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
      title: "入館名簿CSV E2E",
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
  opts: { status?: string } = {},
): Promise<{ userId: string; username: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?)",
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      u.userId,
      role,
      opts.status ?? "confirmed",
      Date.now(),
    )
    .run();
  return u;
}

/** 会場を作る（venues.test.ts と同じAPI経由） */
async function createVenue(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/venues`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: `テスト会場_${crypto.randomUUID().slice(0, 6)}`,
      area: "東京都渋谷区",
      address: "道玄坂1-2-3",
      contact: "X: @venue",
    }),
  });
  expect(res.status).toBe(201);
  const { venue } = (await res.json()) as { venue: { id: string } };
  return venue.id;
}

/** 主催者（admin）→会場へ利用申込オファーを作る。acceptすると成立 */
async function createOffer(
  organizerCookie: string,
  venueId: string,
  eventId: string,
): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/venue-offers`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: organizerCookie },
    body: JSON.stringify({ venueId, eventId, contact: "X: @organizer" }),
  });
  expect(res.status).toBe(201);
  const { offer } = (await res.json()) as { offer: { id: string } };
  return offer.id;
}

async function acceptOffer(ownerCookie: string, offerId: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/venue-offers/${offerId}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ action: "accept" }),
  });
  expect(res.status).toBe(200);
}

async function attendedAtInDb(
  eventId: string,
  userId: string,
): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT attended_at FROM event_member WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ attended_at: number | null }>();
  return row?.attended_at ?? null;
}

async function fetchCsv(
  eventId: string,
  cookie?: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/attendance.csv`, {
    headers: cookie ? { cookie } : {},
  });
}

/** CSV本文を行×セルに分解する（テスト用の簡易パース。引用は考慮しない） */
function parseCsv(text: string): string[][] {
  expect(text.startsWith("\uFEFF")).toBe(true);
  return text
    .slice(1)
    .split("\r\n")
    .filter((l) => l !== "")
    .map((l) => l.split(","));
}

describe("出席時刻の記録 (#154)", () => {
  it("PATCH attendance: true で attended_at が入り、false で NULL に戻る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const member = await makeMember(eventId, "participant");

    const before = Date.now();
    const on = await SELF.fetch(
      `${BASE}/api/events/${eventId}/members/${member.userId}/attendance`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ attended: true }),
      },
    );
    expect(on.status).toBe(200);
    const at = await attendedAtInDb(eventId, member.userId);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
    expect(at!).toBeLessThanOrEqual(Date.now());

    // 取り消しで NULL に戻る
    const off = await SELF.fetch(
      `${BASE}/api/events/${eventId}/members/${member.userId}/attendance`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ attended: false }),
      },
    );
    expect(off.status).toBe(200);
    expect(await attendedAtInDb(eventId, member.userId)).toBeNull();
  });

  it("QR checkin でも attended_at が記録される", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const member = await makeMember(eventId, "participant");

    const ticketRes = await SELF.fetch(
      `${BASE}/api/events/${eventId}/my-ticket`,
      { headers: { cookie: member.cookie } },
    );
    const { token } = (await ticketRes.json()) as CheckinTicket;
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    expect(await attendedAtInDb(eventId, member.userId)).not.toBeNull();
  });
});

describe("入館名簿CSV (#154)", () => {
  it("staff は 200。BOM付きで出席列＋出席時刻(JST)＋アンケート列が出る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);

    // 事前アンケートを1問用意し、参加者が「=」始まりの回答をする
    const putQ = await SELF.fetch(`${BASE}/api/events/${eventId}/survey`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ questions: [{ question: "所属" }] }),
    });
    expect(putQ.status).toBe(200);
    const { questions } = (await putQ.json()) as {
      questions: { id: string }[];
    };

    const attendee = await makeMember(eventId, "participant");
    const waitlist = await makeMember(eventId, "participant", {
      status: "waitlist",
    });
    const putA = await SELF.fetch(`${BASE}/api/events/${eventId}/survey/my`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: attendee.cookie,
      },
      body: JSON.stringify({
        answers: [{ questionId: questions[0].id, value: "=cmd()" }],
      }),
    });
    expect(putA.status).toBe(200);

    // QR受付フローで出席記録
    const ticketRes = await SELF.fetch(
      `${BASE}/api/events/${eventId}/my-ticket`,
      { headers: { cookie: attendee.cookie } },
    );
    const { token } = (await ticketRes.json()) as CheckinTicket;
    await SELF.fetch(`${BASE}/api/events/${eventId}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ token }),
    });

    const res = await fetchCsv(eventId, admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(
      `attendance-${eventId}.csv`,
    );
    const rows = parseCsv(await res.text());
    expect(rows[0]).toEqual([
      "ユーザー名",
      "表示名",
      "ロール",
      "参加状態",
      "出席",
      "出席時刻",
      "所属",
    ]);

    const attendeeRow = rows.find((r) => r[0] === attendee.username)!;
    expect(attendeeRow).toBeTruthy();
    expect(attendeeRow[2]).toBe("参加者");
    expect(attendeeRow[3]).toBe("確定");
    expect(attendeeRow[4]).toBe("出席");
    // JST の YYYY-MM-DD HH:mm
    expect(attendeeRow[5]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // フォーミュラインジェクション対策（' 前置）は名簿CSVでも効く
    expect(attendeeRow[6]).toBe("'=cmd()");

    // キャンセル待ちのメンバーも（確定の後に）載る。未出席は「未」で時刻は空
    const waitlistRow = rows.find((r) => r[0] === waitlist.username)!;
    expect(waitlistRow).toBeTruthy();
    expect(waitlistRow[3]).toBe("キャンセル待ち");
    expect(waitlistRow[4]).toBe("未");
    expect(waitlistRow[5]).toBe("");
    expect(rows.indexOf(waitlistRow)).toBeGreaterThan(
      rows.indexOf(attendeeRow),
    );
  });

  it("成立オファーの会場オーナー/管理者は 200、pending や無関係の会場は 403", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await makeMember(eventId, "participant");

    // 成立オファーの会場（オーナー＋追加管理者）
    const owner = await makeUser();
    const venueId = await createVenue(owner.cookie);
    const venueAdmin = await makeUser();
    await env.DB.prepare(
      "INSERT INTO venue_admin (venue_id, user_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(venueId, venueAdmin.userId, Date.now())
      .run();
    const offerId = await createOffer(admin, venueId, eventId);

    // 承諾前（pending）はダウンロードできない
    expect((await fetchCsv(eventId, owner.cookie)).status).toBe(403);

    await acceptOffer(owner.cookie, offerId);
    const byOwner = await fetchCsv(eventId, owner.cookie);
    expect(byOwner.status).toBe(200);
    expect((await byOwner.text()).startsWith("\uFEFF")).toBe(true);
    expect((await fetchCsv(eventId, venueAdmin.cookie)).status).toBe(200);

    // 無関係な会場のオーナーは 403
    const otherOwner = await makeUser();
    await createVenue(otherOwner.cookie);
    expect((await fetchCsv(eventId, otherOwner.cookie)).status).toBe(403);
  });

  it("participant は 403、未ログインは 401、存在しないイベントは 404", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const participant = await makeMember(eventId, "participant");

    expect((await fetchCsv(eventId, participant.cookie)).status).toBe(403);
    expect((await fetchCsv(eventId)).status).toBe(401);
    expect(
      (await fetchCsv(crypto.randomUUID(), admin)).status,
    ).toBe(404);
  });
});

describe("入館名簿CSVの権限マトリクス補強", () => {
  it("declined・他イベントのオファー持ちは403（DB直挿入でstatus/方向を制御）", async () => {
    const staffCookie = await loginDev();
    const eventId = await setupEvent(staffCookie);

    const mkVenueOffer = async (
      status: string,
      targetEventId: string,
      direction = "event_to_venue",
    ) => {
      const owner = await makeUser();
      const venueId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO venue (id, owner_id, name, created_at, updated_at) VALUES (?, ?, '会場', ?, ?)",
      )
        .bind(venueId, owner.userId, Date.now(), Date.now())
        .run();
      await env.DB.prepare(
        "INSERT INTO venue_offer (id, venue_id, event_id, request_id, direction, status, created_by, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), venueId, targetEventId, direction, status, owner.userId, Date.now())
        .run();
      return owner;
    };

    // declined → 403
    const declinedOwner = await mkVenueOffer("declined", eventId);
    expect((await fetchCsv(eventId, declinedOwner.cookie)).status).toBe(403);

    // venue_to_event 方向の accepted → 200
    const v2eOwner = await mkVenueOffer("accepted", eventId, "venue_to_event");
    expect((await fetchCsv(eventId, v2eOwner.cookie)).status).toBe(200);

    // 別イベントで accepted を持つ会場オーナー → このイベントは403
    const otherEventId = await setupEvent(staffCookie);
    const otherOwner = await mkVenueOffer("accepted", otherEventId);
    expect((await fetchCsv(eventId, otherOwner.cookie)).status).toBe(403);
  });
});
