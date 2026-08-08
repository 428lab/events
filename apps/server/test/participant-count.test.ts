import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Event } from "@eventer/shared";

const BASE = "https://example.com";

/** dev-login（DevUser=staff/管理者）してセッションcookieを返す */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 公開イベントを作る。作成者は staff の event_member 行を持つ */
async function setupEvent(
  cookie: string,
  opts: { attendanceCheck: boolean; startsAt?: number; endsAt?: number },
): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "人数表示",
      venueType: "offline",
      startsAt: opts.startsAt ?? Date.now() + 86400000,
      endsAt: opts.endsAt ?? Date.now() + 90000000,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: { id: string } };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      status: "published",
      attendanceCheck: opts.attendanceCheck,
    }),
  });
  expect(patch.status).toBe(200);
  return event.id;
}

async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, `u_${uid.slice(0, 6)}`, "テスト", Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + 86400000)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function makeMember(
  eventId: string,
  role: "participant" | "staff" | "judge" | "observer",
  opts: { attended?: 0 | 1; slotId?: string } = {},
): Promise<{ userId: string; cookie: string }> {
  const u = await makeUser();
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      u.userId,
      role,
      opts.slotId ?? null,
      opts.attended ?? 0,
      Date.now(),
    )
    .run();
  return u;
}

/** 参加枠を1つ作って id を返す */
async function makeSlot(eventId: string, capacity: number): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO participation_slot (id, event_id, name, capacity, selection_type, sort_order, draw_at, created_at) VALUES (?, ?, ?, ?, 'first_come', 0, NULL, ?)",
  )
    .bind(id, eventId, "一般", capacity, Date.now())
    .run();
  return id;
}

async function fetchEvent(eventId: string): Promise<Event> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { event: Event }).event;
}

/** 参加者一覧（listWithUsers）の件数 */
async function memberListCount(
  eventId: string,
  cookie: string,
): Promise<number> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/members`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { members: unknown[] };
  return body.members.length;
}

describe("参加できる人数の上限", () => {
  it("参加枠が無いイベントは上限なし（null）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, {});
    await makeMember(eventId, "participant");
    expect((await fetchEvent(eventId)).capacityTotal).toBeNull();
  });

  it("枠の合計に、枠を使わない確定メンバーを足す（参加者数と母集団を揃える）", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, {});
    const slot = await makeSlot(eventId, 20);
    // 枠に入った参加者2人 + 枠を使わないスタッフ1人（主催の staff 行も枠なし）
    await makeMember(eventId, "participant", { slotId: slot });
    await makeMember(eventId, "participant", { slotId: slot });
    await makeMember(eventId, "staff");

    const event = await fetchEvent(eventId);
    // 主催(staff) + 追加したstaff = 枠を使わない確定メンバー2人
    expect(event.capacityTotal).toBe(22);
    // 上限は参加者数を下回らない（「6/5人」のような見え方にならない）
    expect(event.participantCount).toBeLessThanOrEqual(event.capacityTotal!);
  });

  it("枠が複数あれば合計する", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, {});
    await makeSlot(eventId, 10);
    await makeSlot(eventId, 5);
    // 主催の staff 行（枠なし）が1人
    expect((await fetchEvent(eventId)).capacityTotal).toBe(16);
  });
});

describe("参加者数・出席者数の表示 (#297)", () => {
  it("出席チェックモードの開催前でも、参加者数が参加者一覧の件数と一致する", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, { attendanceCheck: true });
    // 主催(staff)1 + 参加者4。誰もチェックインしていない
    await makeMember(eventId, "participant");
    await makeMember(eventId, "participant");
    await makeMember(eventId, "participant");
    await makeMember(eventId, "participant");

    const event = await fetchEvent(eventId);
    expect(event.participantCount).toBe(5);
    expect(event.participantCount).toBe(await memberListCount(eventId, cookie));
    // 開催前なので出席者は0（画面では出席を出さない）
    expect(event.attendedCount).toBe(0);
  });

  it("出席者数は役割を問わず、実際に出席が記録された人だけを数える", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, { attendanceCheck: true });
    await makeMember(eventId, "participant", { attended: 1 });
    await makeMember(eventId, "participant", { attended: 1 });
    await makeMember(eventId, "participant");
    // 出席していないスタッフ・審査員は出席者に数えない
    await makeMember(eventId, "staff");
    await makeMember(eventId, "judge");

    const event = await fetchEvent(eventId);
    expect(event.participantCount).toBe(6); // 主催1 + 5人
    expect(event.attendedCount).toBe(2);
  });

  it("出席したスタッフ・審査員は出席者数に入る", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, { attendanceCheck: true });
    await makeMember(eventId, "staff", { attended: 1 });
    await makeMember(eventId, "judge", { attended: 1 });
    await makeMember(eventId, "participant");

    const event = await fetchEvent(eventId);
    expect(event.participantCount).toBe(4);
    expect(event.attendedCount).toBe(2);
  });

  it("出席チェックモードでないイベントは参加者数が確定メンバー数、出席者数は0", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, { attendanceCheck: false });
    await makeMember(eventId, "participant");
    await makeMember(eventId, "participant");

    const event = await fetchEvent(eventId);
    expect(event.participantCount).toBe(3);
    expect(event.participantCount).toBe(await memberListCount(eventId, cookie));
    expect(event.attendedCount).toBe(0);
  });

  it("退会申請中(deleted_at)のメンバーは参加者数・出席者数のどちらからも外す", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, { attendanceCheck: true });
    await makeMember(eventId, "participant", { attended: 1 });
    const gone = await makeMember(eventId, "participant", { attended: 1 });
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), gone.userId)
      .run();

    const event = await fetchEvent(eventId);
    expect(event.participantCount).toBe(2); // 主催1 + 残った1人
    expect(event.participantCount).toBe(await memberListCount(eventId, cookie));
    expect(event.attendedCount).toBe(1);
  });

  it("未確定（抽選待ち・キャンセル）のメンバーは数えない", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, { attendanceCheck: true });
    const pending = await makeUser();
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'participant', NULL, 'pending', 1, ?)",
    )
      .bind(crypto.randomUUID(), eventId, pending.userId, Date.now())
      .run();

    const event = await fetchEvent(eventId);
    expect(event.participantCount).toBe(1); // 主催のみ
    expect(event.attendedCount).toBe(0);
  });

  it("マイページ・公開プロフィールの一覧でも同じ人数を返す", async () => {
    const cookie = await loginDev();
    const eventId = await setupEvent(cookie, { attendanceCheck: true });
    const me = await makeMember(eventId, "participant", { attended: 1 });
    await makeMember(eventId, "participant");

    const mine = await SELF.fetch(`${BASE}/api/me/events`, {
      headers: { cookie: me.cookie },
    });
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as {
      ongoing: Event[];
      past: Event[];
    };
    const row = [...body.ongoing, ...body.past].find((e) => e.id === eventId);
    expect(row).toBeDefined();
    expect(row!.participantCount).toBe(3);
    expect(row!.attendedCount).toBe(1);
  });
});
