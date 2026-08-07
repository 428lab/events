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

/** DB の生の行を読む（API に出ない slot_id まで確認したいため）。行が無ければ null */
async function memberRowOrNull(
  eventId: string,
  userId: string,
): Promise<{ role: string; status: string; slot_id: string | null } | null> {
  return env.DB.prepare(
    "SELECT role, status, slot_id FROM event_member WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<{ role: string; status: string; slot_id: string | null }>();
}

async function memberRow(
  eventId: string,
  userId: string,
): Promise<{ role: string; status: string; slot_id: string | null }> {
  const row = await memberRowOrNull(eventId, userId);
  expect(row).not.toBeNull();
  return row!;
}

/** 個人 Entry があるか（確定参加者に同期されるもの） */
async function hasEntry(eventId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS n FROM entry e JOIN entry_member em ON em.entry_id = e.id
      WHERE e.event_id = ? AND e.kind = 'individual' AND em.user_id = ?`,
  )
    .bind(eventId, userId)
    .first<{ n: number }>();
  return row !== null;
}

async function notificationTypes(userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT type FROM notification WHERE user_id = ? ORDER BY created_at",
  )
    .bind(userId)
    .all<{ type: string }>();
  return results.map((r) => r.type);
}

/** イベントの参加者数（confirmed の在籍数） */
async function participantCount(eventId: string): Promise<number> {
  const res = await SELF.fetch(`${BASE}/api/events/${eventId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { event: Event }).event.participantCount;
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

  it("同じ一般参加者を指定しても参加状態は勝手に確定にならない", async () => {
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
  });

  it("スタッフにしても個人 Entry は作らない（作成者=staff も持たない）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "lottery");
    const b = await makeUser();
    expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("applied");
    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);

    // 確定にするのは運営として関わるためで、作品エントリーの応募ではない。
    // 参加登録・抽選当選・当選操作が Entry を作るのは参加者の枠の話
    expect(await hasEntry(eventId, b.userId)).toBe(false);
  });

  it("確定参加者をスタッフにしても、既にある個人 Entry は消さない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const b = await makeUser();
    // 枠なしイベントは参加即確定。Entry も作られる
    expect(await joinEvent(eventId, b.cookie, "")).toBe("confirmed");
    expect(await hasEntry(eventId, b.userId)).toBe(true);

    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);
    // 参加は確定のまま続いているので、応募済みの Entry を取り上げる理由はない
    expect(await hasEntry(eventId, b.userId)).toBe(true);
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

/** 参加者以外のロールから一般参加者へ戻す経路 (#281)。
 *
 * ロールだけ書き換えると、スタッフにしたときに書いた確定 (#277) が残るため、
 * 往復させるだけで「一度も当選していないのに確定参加者」が作れてしまっていた。
 * 一般参加者に戻す = 参加していない状態に戻す（本人が改めて申し込む）。 */
describe("一般参加者に戻すのは参加の取消 (#281)", () => {
  it("スタッフにしてから一般参加者に戻すと、参加していない状態に戻る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "lottery");
    const base = await participantCount(eventId);
    const b = await makeUser();
    // 一度も当選していない応募中の人
    expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("applied");
    expect(await participantCount(eventId)).toBe(base);

    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);
    expect(await participantCount(eventId)).toBe(base + 1);

    const res = await setRole(eventId, b.userId, "participant", admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      member: EventMember | null;
      promotedUserId: string | null;
    };
    expect(body.member).toBeNull();
    // スタッフは枠を持っていないので、繰り上げる席は空かない
    expect(body.promotedUserId).toBeNull();

    // 確定が残らないこと。行ごと消えるので参加者数にも乗らない
    expect(await memberRowOrNull(eventId, b.userId)).toBeNull();
    expect(await participantCount(eventId)).toBe(base);
    expect(await hasEntry(eventId, b.userId)).toBe(false);
  });

  it("一般参加者に戻された人は、改めて申し込める", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "lottery");
    const b = await makeUser();
    expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("applied");
    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);
    expect(
      (await setRole(eventId, b.userId, "participant", admin)).status,
    ).toBe(200);

    // 申込中に戻れる（メンバー行が残っていると POST /join が即 return して
    // 再応募できず、抽選管理画面からも戻せない行になる）
    expect(await joinEvent(eventId, b.cookie, slot.id)).toBe("applied");
    expect(await memberRow(eventId, b.userId)).toEqual({
      role: "participant",
      status: "applied",
      slot_id: slot.id,
    });
    // 改めて応募したので抽選の対象に戻っている
    expect(await draw(eventId, slot.id, admin)).toEqual({
      drawn: 1,
      confirmed: 1,
      lost: 0,
    });
  });

  it("確定参加者だったスタッフを戻す場合も、参加していない状態に戻る", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const b = await makeUser();
    expect(await joinEvent(eventId, b.cookie, "")).toBe("confirmed");
    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);

    expect(
      (await setRole(eventId, b.userId, "participant", admin)).status,
    ).toBe(200);
    expect(await memberRowOrNull(eventId, b.userId)).toBeNull();
    // 参加確定に付いていた個人 Entry も一緒に片付ける
    expect(await hasEntry(eventId, b.userId)).toBe(false);
    expect(await joinEvent(eventId, b.cookie, "")).toBe("confirmed");
  });

  it("終了済みイベントでは一般参加者に戻せない（参加履歴を消さない）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const b = await makeUser();
    expect(await joinEvent(eventId, b.cookie, "")).toBe("confirmed");
    expect((await setRole(eventId, b.userId, "staff", admin)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE event SET starts_at = ?, ends_at = ? WHERE id = ?",
    )
      .bind(Date.now() - 2 * DAY, Date.now() - DAY, eventId)
      .run();

    // 終了後は本人が申し込み直せないので、消すと戻す手段が無くなる
    const res = await setRole(eventId, b.userId, "participant", admin);
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({
      error: "event_ended",
    });
    expect(await memberRow(eventId, b.userId)).toEqual({
      role: "staff",
      status: "confirmed",
      slot_id: null,
    });
  });

  it("メンバーでない人のロール変更は 404", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const stranger = await makeUser();
    expect(
      (await setRole(eventId, stranger.userId, "participant", admin)).status,
    ).toBe(404);
  });
});

/** 先着枠は確定者が抜けたら繰り上げる (#281)。
 * ロール変更でも枠は空くので、参加解除と同じ繰り上げを通す。 */
describe("スタッフ昇格で空いた先着枠の繰り上げ (#281)", () => {
  it("先着枠の確定者をスタッフにすると、キャンセル待ちが繰り上がる", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "first_come");
    const first = await makeUser();
    const waiting = await makeUser();
    expect(await joinEvent(eventId, first.cookie, slot.id)).toBe("confirmed");
    expect(await joinEvent(eventId, waiting.cookie, slot.id)).toBe("waitlist");

    const res = await setRole(eventId, first.userId, "staff", admin);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { promotedUserId: string | null }).promotedUserId,
    ).toBe(waiting.userId);

    expect(await memberRow(eventId, waiting.userId)).toEqual({
      role: "participant",
      status: "confirmed",
      slot_id: slot.id,
    });
    // 参加解除と同じ後始末（Entry 作成・繰り上げ通知）まで通っていること
    expect(await hasEntry(eventId, waiting.userId)).toBe(true);
    expect(await notificationTypes(waiting.userId)).toContain(
      "waitlist_promoted",
    );
  });

  it("繰り上げが走るので、後から申し込んだ人に横入りされない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "first_come");
    const first = await makeUser();
    const waiting = await makeUser();
    expect(await joinEvent(eventId, first.cookie, slot.id)).toBe("confirmed");
    expect(await joinEvent(eventId, waiting.cookie, slot.id)).toBe("waitlist");
    expect((await setRole(eventId, first.userId, "staff", admin)).status).toBe(
      200,
    );

    // 空いた席は先に待っていた人のもの。後から来た人はキャンセル待ち
    const late = await makeUser();
    expect(await joinEvent(eventId, late.cookie, slot.id)).toBe("waitlist");
    expect((await memberRow(eventId, waiting.userId)).status).toBe("confirmed");
  });

  it("キャンセル待ちが居なければ繰り上げない", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 2, "first_come");
    const first = await makeUser();
    expect(await joinEvent(eventId, first.cookie, slot.id)).toBe("confirmed");

    const res = await setRole(eventId, first.userId, "staff", admin);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { promotedUserId: string | null }).promotedUserId,
    ).toBeNull();
  });

  it("抽選枠では繰り上げない（当落は抽選で決める）", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 1, "lottery");
    const winner = await makeUser();
    const lost = await makeUser();
    expect(await joinEvent(eventId, winner.cookie, slot.id)).toBe("applied");
    expect(await joinEvent(eventId, lost.cookie, slot.id)).toBe("applied");
    expect(await draw(eventId, slot.id, admin)).toEqual({
      drawn: 2,
      confirmed: 1,
      lost: 1,
    });
    const [won, fell] =
      (await memberRow(eventId, winner.userId)).status === "confirmed"
        ? [winner, lost]
        : [lost, winner];

    const res = await setRole(eventId, won.userId, "staff", admin);
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { promotedUserId: string | null }).promotedUserId,
    ).toBeNull();
    // 落選者が勝手に当選にならない（再抽選や当選操作は staff が決める）
    expect((await memberRow(eventId, fell.userId)).status).toBe("lost");
  });
});

/** 当落の手動操作は参加者だけを対象にする (#281)。
 * 0061 より前のデータには「枠を持ったままの確定スタッフ」が居り、
 * この行は抽選管理画面に並ぶので落選を押せてしまう位置にある。 */
describe("当落操作の対象は参加者だけ (#281)", () => {
  /** 旧データ相当の「枠つき確定スタッフ」を直接作る */
  async function legacyMember(
    eventId: string,
    userId: string,
    slotId: string,
    role: string,
  ): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', 0, ?)",
    )
      .bind(crypto.randomUUID(), eventId, userId, role, slotId, Date.now())
      .run();
  }

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

  it.each(["staff", "judge", "observer"])(
    "%s の枠つき確定行を落選に戻せない",
    async (role) => {
      const admin = await loginDev();
      const eventId = await setupEvent(admin);
      const slot = await createSlot(eventId, admin, 5, "lottery");
      const legacy = await makeUser();
      await legacyMember(eventId, legacy.userId, slot.id, role);

      const res = await setSlotStatus(
        eventId,
        slot.id,
        legacy.userId,
        "lost",
        admin,
      );
      expect(res.status).toBe(409);
      expect((await res.json()) as { error: string }).toEqual({
        error: "not_participant",
      });
      // #277 の状態（操作UIは出るのに403）が復活していないこと
      expect(await memberRow(eventId, legacy.userId)).toEqual({
        role,
        status: "confirmed",
        slot_id: slot.id,
      });
    },
  );

  it("参加者への当落操作はこれまでどおり効く", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 5, "lottery");
    const applicant = await makeUser();
    expect(await joinEvent(eventId, applicant.cookie, slot.id)).toBe("applied");

    const res = await setSlotStatus(
      eventId,
      slot.id,
      applicant.userId,
      "confirmed",
      admin,
    );
    expect(res.status).toBe(200);
    expect((await memberRow(eventId, applicant.userId)).status).toBe(
      "confirmed",
    );
    expect(await hasEntry(eventId, applicant.userId)).toBe(true);
  });
});

/** 0061 の WHERE 句が拾う行・拾わない行 (#281)。
 * 適用済みのマイグレーションと同じ SQL を、実データ相当の行に当て直して確かめる。 */
describe("0061 マイグレーションの対象行", () => {
  it("参加者以外の未確定行だけを、枠を外して確定にする", async () => {
    const admin = await loginDev();
    const eventId = await setupEvent(admin);
    const slot = await createSlot(eventId, admin, 5, "lottery");

    // [role, status] と、適用後に期待する [status, 枠が残るか]
    const cases: Array<[string, string, string, boolean]> = [
      ["staff", "applied", "confirmed", false],
      ["staff", "waitlist", "confirmed", false],
      ["staff", "lost", "confirmed", false],
      ["judge", "applied", "confirmed", false],
      ["observer", "waitlist", "confirmed", false],
      // 取消済みは参加履歴として残す行なので触らない
      ["staff", "canceled", "canceled", true],
      // 確定済みで枠つきの行はそのまま（集計を動かさない）
      ["staff", "confirmed", "confirmed", true],
      // 参加者は対象外（抽選の申込中を勝手に確定にしない）
      ["participant", "applied", "applied", true],
      ["participant", "waitlist", "waitlist", true],
    ];
    const users: string[] = [];
    for (const [role, status] of cases) {
      const u = await makeUser();
      users.push(u.userId);
      await env.DB.prepare(
        "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
      )
        .bind(crypto.randomUUID(), eventId, u.userId, role, slot.id, status, Date.now())
        .run();
    }

    const migration = env.TEST_MIGRATIONS.find((m) =>
      m.name.startsWith("0061_"),
    );
    expect(migration).toBeDefined();
    for (const sql of migration!.queries) {
      await env.DB.prepare(sql).run();
    }

    for (const [i, [role, before, status, keepsSlot]] of cases.entries()) {
      const row = await memberRow(eventId, users[i]);
      expect({ role, before, ...row }).toEqual({
        role,
        before,
        status,
        slot_id: keepsSlot ? slot.id : null,
      });
    }
  });
});
