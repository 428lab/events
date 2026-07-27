import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const BASE = "https://example.com";

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 出席チェックモード＋参加者限定の公開イベントを作り、写真を1枚上げる */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "写真×出席E2E",
      venueType: "offline",
      startsAt: 1,
      endsAt: 99999999999999,
    }),
  });
  const { event } = (await create.json()) as { event: { id: string } };
  await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published", attendanceCheck: true }),
  });
  // 1x1 PNG をアップロード
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    ),
    (c) => c.charCodeAt(0),
  );
  const up = await SELF.fetch(`${BASE}/api/events/${event.id}/photos`, {
    method: "POST",
    headers: { "content-type": "image/png", cookie },
    body: png,
  });
  expect(up.status).toBe(201);
  return event.id;
}

/** 未チェックの participant を1人作り、そのセッションcookieを返す */
async function makeUncheckedParticipant(eventId: string): Promise<string> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `x:${uid}`, `guest_${uid.slice(0, 6)}`, "ゲスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'confirmed', 0, ?)",
  )
    .bind(crypto.randomUUID(), eventId, uid, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return `eventer_session=${sid}`;
}

describe("写真×出席チェック (#22)", () => {
  it("出席チェックモード: 未チェックの参加者は写真を閲覧できない(403)、staffは可(200)", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const guest = await makeUncheckedParticipant(eventId);

    // 未チェック参加者 → 403
    const denied = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: guest },
    });
    expect(denied.status).toBe(403);

    // staff(DevUser) → 200
    const staffView = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: staff },
    });
    expect(staffView.status).toBe(200);
  });

  it("出席チェック後は閲覧できる(200)", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    const guest = await makeUncheckedParticipant(eventId);
    // guest の userId を取り出す（session→user）
    const uid = (
      await env.DB.prepare(
        "SELECT user_id AS u FROM session WHERE id = ?",
      )
        .bind(guest.split("=")[1])
        .first<{ u: string }>()
    )!.u;

    // staff が出席チェック
    const patch = await SELF.fetch(
      `${BASE}/api/events/${eventId}/members/${uid}/attendance`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: staff },
        body: JSON.stringify({ attended: true }),
      },
    );
    expect(patch.status).toBe(200);

    // 出席済み → 200
    const ok = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: guest },
    });
    expect(ok.status).toBe(200);
  });

  it("写真を公開設定にすると未ログインでも閲覧できる(200)", async () => {
    const staff = await loginDev();
    const eventId = await setupEvent(staff);
    // 公開ON
    await SELF.fetch(`${BASE}/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: staff },
      body: JSON.stringify({ photosPublic: true }),
    });
    // 未ログイン（cookieなし）→ 200
    const anon = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`);
    expect(anon.status).toBe(200);
  });
});
