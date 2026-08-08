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

/** 非adminのメンバーを1人作り、{ userId, cookie } を返す。
 * discord_id は ADMIN_DISCORD_IDS(=dev-user) と一致させないので管理者にはならない。 */
async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  attended: 0 | 1,
  status = "confirmed",
): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, uid, role, status, attended, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

describe("写真の閲覧は参加確定の人だけ (#289)", () => {
  it("落選・申込中・キャンセル待ちは閲覧できない（出席チェックを使わないイベントでも）", async () => {
    const admin = await loginDev();
    // setupEvent は出席チェックモードで作るので、それを切って素のイベントにする。
    // 出席チェックの分岐ではなく status の分岐そのものを検証したい
    const eventId = await setupEvent(admin);
    await env.DB.prepare("UPDATE event SET attendance_check = 0 WHERE id = ?")
      .bind(eventId)
      .run();

    for (const status of ["lost", "applied", "waitlist"] as const) {
      const m = await makeMember(eventId, "participant", 0, status);
      const res = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
        headers: { cookie: m.cookie },
      });
      expect(res.status).toBe(403);
    }

    // 確定した人は見られる（塞ぎすぎていないことの対）
    const ok = await makeMember(eventId, "participant", 0);
    const allowed = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: ok.cookie },
    });
    expect(allowed.status).toBe(200);
  });

  it("公開設定のイベントは、参加が確定していなくても見られる（公開の意味を壊さない）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    await env.DB.prepare(
      "UPDATE event SET attendance_check = 0, photos_public = 1 WHERE id = ?",
    )
      .bind(eventId)
      .run();

    const lost = await makeMember(eventId, "participant", 0, "lost");
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: lost.cookie },
    });
    expect(res.status).toBe(200);
  });
});

describe("写真×出席チェック (#22)", () => {
  it("出席チェックモード: 未チェックの参加者は閲覧不可(403)、未チェックでもstaffは可(200)、未ログインは403", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const participant = await makeMember(eventId, "participant", 0);
    // 非adminのstaff（出席未チェック）＝ role<>participant の分岐を実際に検証
    const staff = await makeMember(eventId, "staff", 0);

    // 未チェック participant → 403
    const denied = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: participant.cookie },
    });
    expect(denied.status).toBe(403);

    // 未ログイン（参加者限定なので）→ 403
    const anon = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`);
    expect(anon.status).toBe(403);

    // 非adminのstaff（未チェックでも）→ 200
    const staffView = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: staff.cookie },
    });
    expect(staffView.status).toBe(200);
  });

  it("出席チェック後は participant も閲覧できる(200)", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const participant = await makeMember(eventId, "participant", 0);

    // 事前は 403
    const before = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: participant.cookie },
    });
    expect(before.status).toBe(403);

    // staff(admin) が出席チェック
    const patch = await SELF.fetch(
      `${BASE}/api/events/${eventId}/members/${participant.userId}/attendance`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ attended: true }),
      },
    );
    expect(patch.status).toBe(200);

    // 出席済み → 200
    const ok = await SELF.fetch(`${BASE}/api/events/${eventId}/photos`, {
      headers: { cookie: participant.cookie },
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
