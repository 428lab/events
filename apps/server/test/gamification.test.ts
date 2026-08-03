import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { levelFromXp, xpForLevel } from "@eventer/shared";
import type { Gamification } from "@eventer/shared";

const BASE = "https://example.com";

/** ユーザーを1人作る（セッション不要な集計テスト用） */
async function insertUser(): Promise<{ userId: string; username: string }> {
  const uid = crypto.randomUUID();
  const username = `g_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(uid, `nostr:${uid}`, username, "テスト", Date.now())
    .run();
  return { userId: uid, username };
}

/** イベントを直接作成し、オーナーの確定スタッフ行も張る（主催の判定条件） */
async function insertEvent(
  ownerId: string,
  opts: {
    startsAt: number;
    endsAt: number;
    status?: string;
    attendanceCheck?: boolean;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event (id, title, starts_at, ends_at, venue_type, status, attendance_check, created_by, created_at)
     VALUES (?, ?, ?, ?, 'online', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `ゲーミフィケーションE2E_${id.slice(0, 6)}`,
      opts.startsAt,
      opts.endsAt,
      opts.status ?? "published",
      opts.attendanceCheck ? 1 : 0,
      ownerId,
      Date.now(),
    )
    .run();
  await addMember(id, ownerId, "staff");
  return id;
}

/** 確定メンバー行を追加する */
async function addMember(
  eventId: string,
  userId: string,
  role: "staff" | "participant",
  attended = 0,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_member (id, event_id, user_id, role, slot_id, status, attended, created_at) VALUES (?, ?, ?, ?, NULL, 'confirmed', ?, ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, role, attended, Date.now())
    .run();
}

/** 頭数合わせの確定参加者を n 人追加する（有効イベント判定の4人以上を満たす用） */
async function fillMembers(eventId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const u = await insertUser();
    await addMember(eventId, u.userId, "participant");
  }
}

/** 公開プロフィールからゲーミフィケーション情報を取得する */
async function fetchGamification(username: string): Promise<Gamification> {
  const res = await SELF.fetch(`${BASE}/api/public/users/${username}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { gamification: Gamification };
  return body.gamification;
}

/** 終了済みイベントの時刻（2〜1時間前） */
function endedTimes(now: number) {
  return { startsAt: now - 7200_000, endsAt: now - 3600_000 };
}

describe("レベル計算（共有の純粋関数） (#14)", () => {
  it("xpForLevel: Lv1=0, Lv2=100, Lv3=300, Lv5=1000, Lv10=4500", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(5)).toBe(1000);
    expect(xpForLevel(10)).toBe(4500);
  });

  it("levelFromXp: 0→Lv1, 100→Lv2, 299→Lv2, 300→Lv3", () => {
    expect(levelFromXp(0)).toEqual({
      level: 1,
      currentXp: 0,
      currentLevelXp: 0,
      nextLevelXp: 100,
    });
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(299).level).toBe(2);
    expect(levelFromXp(299).nextLevelXp).toBe(300);
    expect(levelFromXp(300).level).toBe(3);
    expect(levelFromXp(300).currentLevelXp).toBe(300);
  });
});

describe("ゲーミフィケーション (#14)", () => {
  it("実績のないユーザーにも gamification ブロックが返る", async () => {
    const u = await insertUser();
    const g = await fetchGamification(u.username);
    expect(g).toEqual({
      xp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      badges: [],
    });
  });

  it("確定メンバー3人の終了イベントはXPにならず、4人で有効になる", async () => {
    const owner = await insertUser();
    const now = Date.now();
    const ev = await insertEvent(owner.userId, endedTimes(now));
    await fillMembers(ev, 2); // オーナー含め3人 → 有効イベントではない

    const g1 = await fetchGamification(owner.username);
    expect(g1.xp).toBe(0);
    expect(g1.badges).toEqual([]);

    await fillMembers(ev, 1); // 4人目 → 有効イベントに昇格
    const g2 = await fetchGamification(owner.username);
    expect(g2.xp).toBe(100); // 主催 100
    expect(g2.level).toBe(2);
    expect(g2.badges.map((b) => b.key)).toContain("first-host");
  });

  it("重み付け: 主催100・スタッフ50・登壇40・参加10・被いいね5×2 = 210", async () => {
    const u = await insertUser();
    const other = await insertUser();
    const now = Date.now();

    // 主催イベント（u がオーナー、計4人）
    const evHost = await insertEvent(u.userId, endedTimes(now));
    await fillMembers(evHost, 3);
    // 被いいね2件（主催・スタッフ向けいいね。押した人は別ユーザー）
    for (let i = 0; i < 2; i++) {
      const liker = await insertUser();
      await env.DB.prepare(
        "INSERT INTO event_like (id, event_id, user_id, kind, target_key, created_at) VALUES (?, ?, ?, 'host', ?, ?)",
      )
        .bind(crypto.randomUUID(), evHost, liker.userId, u.userId, Date.now())
        .run();
    }

    // スタッフ参加イベント（オーナーは別人、u はスタッフ、計4人）
    const evStaff = await insertEvent(other.userId, endedTimes(now));
    await addMember(evStaff, u.userId, "staff");
    await fillMembers(evStaff, 2);

    // 登壇イベント（複数コマでも1イベント分。u はメンバーではない）
    const evSpeak = await insertEvent(other.userId, endedTimes(now));
    await fillMembers(evSpeak, 3);
    for (const order of [0, 1]) {
      await env.DB.prepare(
        "INSERT INTO event_schedule_item (id, event_id, title, description, duration_min, starts_at, speaker_user_id, speaker_name, sort_order, created_at) VALUES (?, ?, 'トーク', '', 20, NULL, ?, '', ?, ?)",
      )
        .bind(crypto.randomUUID(), evSpeak, u.userId, order, Date.now())
        .run();
    }

    // 参加イベント（出席チェックなし運用 = 登録で出席扱い）
    const evAttend = await insertEvent(other.userId, endedTimes(now));
    await addMember(evAttend, u.userId, "participant");
    await fillMembers(evAttend, 2);

    const g = await fetchGamification(u.username);
    expect(g.xp).toBe(210); // 100 + 50 + 40 + 10 + 5×2
    const lv = levelFromXp(210);
    expect(g.level).toBe(lv.level); // Lv2
    expect(g.currentLevelXp).toBe(lv.currentLevelXp);
    expect(g.nextLevelXp).toBe(lv.nextLevelXp);
    const keys = g.badges.map((b) => b.key);
    expect(keys).toContain("first-host");
    expect(keys).toContain("first-staff");
    expect(keys).toContain("first-speak");
  });

  it("下書き・未来のイベントはXPにならない", async () => {
    const u = await insertUser();
    const now = Date.now();

    // 終了済みだが下書きのまま
    const draft = await insertEvent(u.userId, {
      ...endedTimes(now),
      status: "draft",
    });
    await fillMembers(draft, 3);

    // 公開済みだが未来開催
    const future = await insertEvent(u.userId, {
      startsAt: now + 3600_000,
      endsAt: now + 7200_000,
    });
    await fillMembers(future, 3);

    const g = await fetchGamification(u.username);
    expect(g.xp).toBe(0);
    expect(g.badges).toEqual([]);
  });

  it("バッジ境界値: 主催4回では『主催の常連』は付かず、5回ちょうどで付く", async () => {
    const u = await insertUser();
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      const ev = await insertEvent(u.userId, endedTimes(now));
      await fillMembers(ev, 3);
    }
    const g1 = await fetchGamification(u.username);
    expect(g1.xp).toBe(400);
    expect(g1.badges.map((b) => b.key)).toContain("first-host");
    expect(g1.badges.map((b) => b.key)).not.toContain("host-5");

    const ev5 = await insertEvent(u.userId, endedTimes(now));
    await fillMembers(ev5, 3);
    const g2 = await fetchGamification(u.username);
    expect(g2.xp).toBe(500);
    expect(g2.level).toBe(3); // Lv3=300 <= 500 < Lv4=600
    expect(g2.badges.map((b) => b.key)).toContain("host-5");
  });

  it("出席チェックONのイベントは出席記録がないと参加XPにならない", async () => {
    const u = await insertUser();
    const other = await insertUser();
    const now = Date.now();
    const ev = await insertEvent(other.userId, {
      ...endedTimes(now),
      attendanceCheck: true,
    });
    await addMember(ev, u.userId, "participant", 0); // 出席記録なし
    await fillMembers(ev, 2);

    const g1 = await fetchGamification(u.username);
    expect(g1.xp).toBe(0);

    await env.DB.prepare(
      "UPDATE event_member SET attended = 1 WHERE event_id = ? AND user_id = ?",
    )
      .bind(ev, u.userId)
      .run();
    const g2 = await fetchGamification(u.username);
    expect(g2.xp).toBe(10);
  });
});
