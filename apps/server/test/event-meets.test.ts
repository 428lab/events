import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Gamification, MeetableEvent } from "@eventer/shared";

const BASE = "https://example.com";

/** 一般ユーザーを1人作る（セッション付き） */
async function makeUser(): Promise<{
  userId: string;
  username: string;
  cookie: string;
}> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const username = `m_${uid.slice(0, 8)}`;
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

/** イベント行を直接作る（既定は公開・開催中: 1時間前開始〜1時間後終了） */
async function insertEvent(
  ownerId: string,
  opts: {
    startsAt?: number;
    endsAt?: number;
    status?: string;
    attendanceCheck?: boolean;
    scheduling?: boolean;
  } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, attendance_check, scheduling, created_by, created_at)
     VALUES (?, ?, ?, ?, 'offline', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `出会いE2E_${id.slice(0, 6)}`,
      opts.scheduling ? 0 : (opts.startsAt ?? now - 3600_000),
      opts.scheduling ? 0 : (opts.endsAt ?? now + 3600_000),
      opts.status ?? "published",
      opts.attendanceCheck ? 1 : 0,
      opts.scheduling ? 1 : 0,
      ownerId,
      Date.now(),
    )
    .run();
  return id;
}

/** 確定メンバー行を直接作る */
async function addMember(
  eventId: string,
  userId: string,
  role: "participant" | "staff" = "participant",
  attended = 0,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, attended, Date.now())
    .run();
}

async function postMeet(
  eventId: string,
  cookie: string,
  userId: string,
): Promise<Response> {
  return SELF.fetch(`${BASE}/api/events/${eventId}/meet`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ userId }),
  });
}

async function getMeetable(
  targetUserId: string,
  cookie: string,
): Promise<MeetableEvent[]> {
  const res = await SELF.fetch(`${BASE}/api/users/${targetUserId}/meetable`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { events: MeetableEvent[] }).events;
}

/** 出会い行を直接挿入（ペアは低/高に正規化） */
async function insertMeet(
  eventId: string,
  a: string,
  b: string,
): Promise<void> {
  const [low, high] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    "INSERT INTO event_meet (id, event_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, low, high, Date.now())
    .run();
}

describe("出会った記録 (#189)", () => {
  it("開催中イベントの確定メンバー同士は記録でき、同一ペアの2回目は created=false、相手に通知が入る", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // meetable にイベントが出る
    const meetable = await getMeetable(b.userId, a.cookie);
    expect(meetable.map((e) => e.id)).toContain(eventId);

    // 1回目は created=true・出会い数1
    const r1 = await postMeet(eventId, a.cookie, b.userId);
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { created: boolean; meets: number };
    expect(body1.created).toBe(true);
    expect(body1.meets).toBe(1);

    // 2回目（逆方向でも同一ペア）は created=false のまま冪等
    const r2 = await postMeet(eventId, b.cookie, a.userId);
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as { created: boolean; meets: number };
    expect(body2.created).toBe(false);
    expect(body2.meets).toBe(1);

    // 相手（b）に meet 通知が1件だけ入る
    const notif = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND type = 'meet'",
    )
      .bind(b.userId)
      .first<{ n: number }>();
    expect(notif?.n).toBe(1);
  });

  it("自分自身は400、非メンバーは403（自分・相手どちらでも）", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const outsider = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);

    const self = await postMeet(eventId, a.cookie, a.userId);
    expect(self.status).toBe(400);
    expect(((await self.json()) as { error: string }).error).toBe("self_meet");

    // 自分が非メンバー
    const r1 = await postMeet(eventId, outsider.cookie, a.userId);
    expect(r1.status).toBe(403);
    // 相手が非メンバー
    const r2 = await postMeet(eventId, a.cookie, outsider.userId);
    expect(r2.status).toBe(403);
    expect(((await r2.json()) as { error: string }).error).toBe(
      "target_not_member",
    );

    // 自分自身の meetable は常に空
    expect(await getMeetable(a.userId, a.cookie)).toEqual([]);
  });

  it("開催時間帯の外・日程調整中・下書きは記録できない", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const now = Date.now();

    // 開始30分前より前（未来イベント）
    const future = await insertEvent(owner.userId, {
      startsAt: now + 7200_000,
      endsAt: now + 10800_000,
    });
    await addMember(future, a.userId);
    await addMember(future, b.userId);
    const r1 = await postMeet(future, a.cookie, b.userId);
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as { error: string }).error).toBe(
      "outside_window",
    );
    // meetable にも出ない
    expect(await getMeetable(b.userId, a.cookie)).toEqual([]);

    // 終了2時間後より後
    const past = await insertEvent(owner.userId, {
      startsAt: now - 14400_000,
      endsAt: now - 10800_000,
    });
    await addMember(past, a.userId);
    await addMember(past, b.userId);
    const r2 = await postMeet(past, a.cookie, b.userId);
    expect(r2.status).toBe(409);

    // 日程調整中
    const scheduling = await insertEvent(owner.userId, { scheduling: true });
    await addMember(scheduling, a.userId);
    await addMember(scheduling, b.userId);
    const r3 = await postMeet(scheduling, a.cookie, b.userId);
    expect(r3.status).toBe(409);

    // 下書き
    const draft = await insertEvent(owner.userId, { status: "draft" });
    await addMember(draft, a.userId);
    await addMember(draft, b.userId);
    const r4 = await postMeet(draft, a.cookie, b.userId);
    expect(r4.status).toBe(409);
    expect(((await r4.json()) as { error: string }).error).toBe(
      "not_published",
    );
  });

  it("出席チェックONでも、出席していない相手と記録できる (#330)", async () => {
    // 以前は「両者とも出席済み」を条件にしていたため、受付を通していない人と
    // 記録できず、実際のイベントで「出会ったボタンが出ない」事象が起きた
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId, { attendanceCheck: true });
    await addMember(eventId, a.userId, "participant", 1); // a は出席済み
    await addMember(eventId, b.userId, "participant", 0); // b は未出席

    // ボタンが出る（meetable に載る）
    expect(await getMeetable(b.userId, a.cookie)).toHaveLength(1);
    const r1 = await postMeet(eventId, a.cookie, b.userId);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { created: boolean }).created).toBe(true);

    // どちらも未出席でも記録できる
    const c = await makeUser();
    const d = await makeUser();
    const other = await insertEvent(owner.userId, { attendanceCheck: true });
    await addMember(other, c.userId, "participant", 0);
    await addMember(other, d.userId, "participant", 0);
    expect(await getMeetable(d.userId, c.cookie)).toHaveLength(1);
    expect((await postMeet(other, c.cookie, d.userId)).status).toBe(200);
    // 記録しただけで出席は付かない（出席は staff が絡む読み取りだけ #330）
    const row = await env.DB.prepare(
      "SELECT attended FROM event_member WHERE event_id = ? AND user_id = ?",
    )
      .bind(other, c.userId)
      .first<{ attended: number }>();
    expect(row?.attended).toBe(0);
  });

  it("XP: 有効イベントの出会いは1件5XP・1イベント10件まで、first-meet バッジが付く", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const now = Date.now();
    // 有効イベント（公開・終了済み・確定メンバー4人）。u はメンバーにせずXPを出会い分だけに絞る
    const eventId = await insertEvent(owner.userId, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
    });
    await addMember(eventId, owner.userId, "staff");
    for (let i = 0; i < 3; i++) {
      const filler = await makeUser();
      await addMember(eventId, filler.userId, "participant");
    }

    // 12人と出会った記録を直接挿入 → 全件XPに数えられる（上限なしの信頼ベース運用）
    for (let i = 0; i < 12; i++) {
      const partner = await makeUser();
      await insertMeet(eventId, u.userId, partner.userId);
    }

    const res = await SELF.fetch(`${BASE}/api/public/users/${u.username}`);
    expect(res.status).toBe(200);
    const { gamification } = (await res.json()) as {
      gamification: Gamification;
    };
    expect(gamification.xp).toBe(60); // 12 × 5
    const keys = gamification.badges.map((b) => b.key);
    expect(keys).toContain("first-meet");
    expect(keys).not.toContain("meet-30");
  });

  it("XP: 有効でないイベント（3人以下）の出会いは数えられない", async () => {
    const owner = await makeUser();
    const u = await makeUser();
    const now = Date.now();
    // 確定メンバー3人（4人未満）の終了イベント → 有効イベントではない
    const eventId = await insertEvent(owner.userId, {
      startsAt: now - 7200_000,
      endsAt: now - 3600_000,
    });
    await addMember(eventId, owner.userId, "staff");
    for (let i = 0; i < 2; i++) {
      const filler = await makeUser();
      await addMember(eventId, filler.userId, "participant");
    }
    const partner = await makeUser();
    await insertMeet(eventId, u.userId, partner.userId);

    const res = await SELF.fetch(`${BASE}/api/public/users/${u.username}`);
    expect(res.status).toBe(200);
    const { gamification } = (await res.json()) as {
      gamification: Gamification;
    };
    expect(gamification.xp).toBe(0);
    expect(gamification.badges).toEqual([]);
  });
});

describe("出会いランキング（スタッフのみ）", () => {
  it("両方向合算で降順、非staffは403", async () => {
    const owner = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, owner.userId, "staff");
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    for (const u of [a, b, c]) await addMember(eventId, u.userId);
    // a-b, a-c を記録（a=2, b=1, c=1）
    for (const [x, y] of [[a, b], [a, c]] as const) {
      const [low, high] = x.userId < y.userId ? [x.userId, y.userId] : [y.userId, x.userId];
      await env.DB.prepare(
        "INSERT INTO event_meet (id, event_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), eventId, low, high, Date.now())
        .run();
    }
    const forbidden = await SELF.fetch(
      `${BASE}/api/events/${eventId}/meets/ranking`,
      { headers: { cookie: a.cookie } },
    );
    expect(forbidden.status).toBe(403);

    const res = await SELF.fetch(
      `${BASE}/api/events/${eventId}/meets/ranking`,
      { headers: { cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const { ranking } = (await res.json()) as {
      ranking: { userId: string; count: number }[];
    };
    expect(ranking[0].userId).toBe(a.userId);
    expect(ranking[0].count).toBe(2);
    expect(ranking.length).toBe(3);
  });
});
