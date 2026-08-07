import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Event, EventMember, ParticipationSlot } from "@eventer/shared";

const BASE = "https://example.com";
const DAY = 86400000;

/** 参加者以外のロールは参加枠を消費しない (#277)。
 *
 * 抽選枠に応募中（applied）や先着枠のキャンセル待ち（waitlist）のままスタッフに
 * すると、抽選で落選（lost）になり、画面はロールを見て操作UIを出すのにサーバーは
 * 参加確定を要求するので削除・非表示が無言で403になっていた。
 * ロール変更で枠を外して確定にし、抽選の対象も参加者に限る。 */

/** dev-login（DevUser=イベント作成者＝staff・アプリ運営管理者） */
async function loginDev(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/dev-login`, { method: "POST" });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** 非adminのユーザーを1人作る（メンバーにはしない） */
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
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** 公開イベントを作って ID を返す */
async function setupEvent(cookie: string): Promise<string> {
  const create = await SELF.fetch(`${BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "スタッフ昇格テスト",
      venueType: "offline",
      startsAt: Date.now() + 7 * DAY,
      endsAt: Date.now() + 8 * DAY,
    }),
  });
  expect(create.status).toBe(201);
  const { event } = (await create.json()) as { event: Event };
  const patch = await SELF.fetch(`${BASE}/api/events/${event.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ status: "published" }),
  });
  expect(patch.status).toBe(200);
  return event.id;
}

async function createSlot(
  eventId: string,
  cookie: string,
  capacity: number,
  selectionType: "first_come" | "lottery",
): Promise<ParticipationSlot> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "一般枠", capacity, selectionType }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { slot: ParticipationSlot }).slot;
}

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

async function setRole(
  eventId: string,
  userId: string,
  role: string,
  cookie: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/members/${userId}/role`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role }),
  });
}

/** DB の生の行を読む（API に出ない slot_id まで確認したいため） */
async function memberRow(
  eventId: string,
  userId: string,
): Promise<{ role: string; status: string; slot_id: string | null }> {
  const row = await env.DB.prepare(
    "SELECT role, status, slot_id FROM event_member WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ role: string; status: string; slot_id: string | null }>();
  expect(row).not.toBeNull();
  return row!;
}

async function draw(
  eventId: string,
  slotId: string,
  cookie: string,
): Promise<{ drawn: number; confirmed: number; lost: number }> {
  const res = await SELF.fetch(
    `${BASE}/api/events/${eventId}/slots/${slotId}/draw`,
    { method: "POST", headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    drawn: number;
    confirmed: number;
    lost: number;
  };
}

describe("参加者以外のロールは参加枠を消費しない (#277)", () => {
  it("抽選枠に応募中の人をスタッフにすると、枠が外れて参加確定になる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "lottery");
    const b = await makeUser();
    expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("applied");

    const res = await setRole(eventId, b.userId, "staff", admin);
    expect(res.status).toBe(200);
    const { member } = (await res.json()) as { member: EventMember };
    expect(member.role).toBe("staff");
    expect(member.status).toBe("confirmed");
    expect(member.slotId).toBeNull();

    const row = await memberRow(eventId, b.userId);
    expect(row).toEqual({ role: "staff", status: "confirmed", slot_id: null });
  });

  it("スタッフにした後に抽選しても、その人の参加状態は変わらない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    // 定員1。他に応募者を1人置き、スタッフが枠を食っていないことも見る
    const slot = await createSlot(eventId, admin, 1, "lottery");
    const b = await makeUser();
    const other = await makeUser();
    expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("applied");
    expect(await joinEvent(eventId, other.cookie, slot.id)).toBe("applied");
    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);

    const result = await draw(eventId, slot.id, admin);
    // 抽選の対象は参加者のまま残った1人だけ
    expect(result).toEqual({ drawn: 1, confirmed: 1, lost: 0 });

    // スタッフは確定のまま（落選しない）
    expect(await memberRow(eventId, b.userId)).toEqual({
      role: "staff",
      status: "confirmed",
      slot_id: null,
    });
    // 枠が空いたので、残った応募者が当選できている
    expect((await memberRow(eventId, other.userId)).status).toBe("confirmed");
  });

  it.each(["judge", "observer"])(
    "%s にした場合もスタッフと同じく枠が外れて確定になる",
    async (role) => {
      const admin = await loginDev();
      const eventId = await setupEvent(admin);
      const slot = await createSlot(eventId, admin, 1, "lottery");
      const b = await makeUser();
      expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("applied");

      expect((await setRole(eventId, b.userId, role, admin)).status).toBe(200);
      expect(await memberRow(eventId, b.userId)).toEqual({
        role,
        status: "confirmed",
        slot_id: null,
      });

      // 抽選しても対象外
      expect(await draw(eventId, slot.id, admin)).toEqual({
        drawn: 0,
        confirmed: 0,
        lost: 0,
      });
      expect((await memberRow(eventId, b.userId)).status).toBe("confirmed");
    },
  );

  it("先着枠のキャンセル待ちをスタッフにしても、枠が外れて確定になる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "first_come");
    const first = await makeUser();
    const b = await makeUser();
    expect(await joinEvent(eventId, first.cookie, slot.id)).toBe("confirmed");
    expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("waitlist");

    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);
    expect(await memberRow(eventId, b.userId)).toEqual({
      role: "staff",
      status: "confirmed",
      slot_id: null,
    });
  });

  it("一般参加者に変更しても参加状態は勝手に確定にならない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "first_come");
    const first = await makeUser();
    const waiting = await makeUser();
    expect(await joinEvent(eventId, first.cookie, slot.id)).toBe("confirmed");
    expect(await joinEvent(eventId, waiting.cookie, slot.id)).toBe("waitlist");

    // participant → participant（キャンセル待ちのまま。ここで確定にすると
    // 「降格したら参加確定」という逆向きの権限が湧いてしまう）
    expect(
      (await setRole(eventId, waiting.userId, "participant", admin)).status,
    ).toBe(200);
    expect(await memberRow(eventId, waiting.userId)).toEqual({
      role: "participant",
      status: "waitlist",
      slot_id: slot.id,
    });

    // 落選したスタッフを参加者に戻す場合も、落選のまま（要・再応募）
    const lost = await makeUser();
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'staff', ?, 'lost', 0, ?)",
    )
      .bind(crypto.randomUUID(), eventId, lost.userId, slot.id, Date.now())
      .run();
    expect(
      (await setRole(eventId, lost.userId, "participant", admin)).status,
    ).toBe(200);
    expect(await memberRow(eventId, lost.userId)).toEqual({
      role: "participant",
      status: "lost",
      slot_id: slot.id,
    });
  });

  it("ロール変更を経ずに枠に居座っているスタッフも抽選の対象にしない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 5, "lottery");
    const applicant = await makeUser();
    expect(await joinEvent(eventId, applicant.cookie, slot.id)).toBe("applied");

    // 旧データ相当（枠つき・申込中のスタッフ）を直接作る
    const legacy = await makeUser();
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, 'staff', ?, 'applied', 0, ?)",
    )
      .bind(crypto.randomUUID(), eventId, legacy.userId, slot.id, Date.now())
      .run();

    expect(await draw(eventId, slot.id, admin)).toEqual({
      drawn: 1,
      confirmed: 1,
      lost: 0,
    });
    // スタッフは当選も落選もしない（申込のまま）
    expect((await memberRow(eventId, legacy.userId)).status).toBe("applied");
    expect((await memberRow(eventId, applicant.userId)).status).toBe(
      "confirmed",
    );
  });
});
