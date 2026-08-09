import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Gamification } from "@eventer/shared";

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

describe("ボタンで記録する旧経路の廃止 (#330)", () => {
  it("相手を指定して記録する経路は残っていない（対面の裏付けが無いため）", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const eventId = await insertEvent(owner.userId);
    await addMember(eventId, a.userId);
    await addMember(eventId, b.userId);

    // 開催中・両者とも確定メンバー、という「以前なら通った」条件でも受け付けない。
    // 残しておくと、参加者一覧から相手を選ぶだけで出会いを量産できてしまう
    const res = await SELF.fetch(`${BASE}/api/events/${eventId}/meet`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: a.cookie },
      body: JSON.stringify({ userId: b.userId }),
    });
    expect(res.status).toBe(404);

    // 共通イベントの一覧（ボタンの出し分け用）も無くなっている
    const meetable = await SELF.fetch(
      `${BASE}/api/users/${b.userId}/meetable`,
      { headers: { cookie: a.cookie } },
    );
    expect(meetable.status).toBe(404);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM event_meet WHERE event_id = ?",
    )
      .bind(eventId)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe("出会いのXP (#189)", () => {
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
