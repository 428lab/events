import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/** 最終アクセス時刻 user.last_seen_at (#257)。DAU/MAU 計測の土台。
 * 「JSTの日付が変わった最初の1回だけ UPDATE する」ことが肝で、
 * ここが崩れると全リクエストで D1 への書き込みが1本増える */

const BASE = "https://example.com";
const DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET = 9 * 60 * 60 * 1000;

interface TestUser {
  userId: string;
  cookie: string;
}

/** ユーザー1人＋セッションを作る。lastSeenAt を渡すと初期値として入れる */
async function makeUser(lastSeenAt: number | null = null): Promise<TestUser> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, last_seen_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
  )
    .bind(uid, `t:${uid}`, `t_${uid.slice(0, 8)}`, Date.now(), lastSeenAt)
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function lastSeen(userId: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT last_seen_at FROM user WHERE id = ?")
    .bind(userId)
    .first<{ last_seen_at: number | null }>();
  return row?.last_seen_at ?? null;
}

/** 認証つきの普通のリクエスト（currentUser を通る経路なら何でもよい） */
async function hit(cookie?: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/auth/me`, {
    headers: cookie ? { cookie } : {},
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 更新は waitUntil の中なので、値が変わるまで少し待つ */
async function waitForChange(
  userId: string,
  prev: number | null,
): Promise<number | null> {
  for (let i = 0; i < 50; i += 1) {
    const v = await lastSeen(userId);
    if (v !== prev) return v;
    await sleep(10);
  }
  return lastSeen(userId);
}

/** JST で「今日」の 00:01 の epoch ms（同一日の別時刻を作るため） */
function jstTodayStart(now = Date.now()): number {
  return Math.floor((now + JST_OFFSET) / DAY) * DAY - JST_OFFSET + 60_000;
}

describe("last_seen_at (#257)", () => {
  it("認証つきリクエストで last_seen_at が入る", async () => {
    const u = await makeUser();
    const before = Date.now();
    const res = await hit(u.cookie);
    expect(res.status).toBe(200);

    const v = await waitForChange(u.userId, null);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThanOrEqual(before);
    expect(v!).toBeLessThanOrEqual(Date.now());
  });

  it("同じJSTの日のうちは UPDATE が走らない（値が変わらない）", async () => {
    // 今日の JST 00:01 を最終アクセスとして持つユーザー。
    // 「日付が変わったときだけ」の判定が効いていれば一切書き換わらない
    const sameDay = jstTodayStart();
    const u = await makeUser(sameDay);

    for (let i = 0; i < 3; i += 1) {
      const res = await hit(u.cookie);
      expect(res.status).toBe(200);
    }
    // waitUntil の書き込みが遅れて来ないことも確かめる
    await sleep(100);
    expect(await lastSeen(u.userId)).toBe(sameDay);
  });

  it("初回アクセス後、同じ日の2回目では UPDATE が走らない", async () => {
    const u = await makeUser();
    await hit(u.cookie);
    const first = await waitForChange(u.userId, null);
    expect(first).not.toBeNull();

    // 同じ JST 日の別時刻に書き換えてから叩く。更新が走れば now に上書きされる
    const sameDayEarlier = jstTodayStart();
    await env.DB.prepare("UPDATE user SET last_seen_at = ? WHERE id = ?")
      .bind(sameDayEarlier, u.userId)
      .run();

    await hit(u.cookie);
    await sleep(100);
    expect(await lastSeen(u.userId)).toBe(sameDayEarlier);
  });

  it("JSTの日付が変わったら更新される", async () => {
    // 前日にバックデートした状態のユーザー（＝昨日が最終アクセス）を用意する。
    // 「同一日の2回目」の抑止に引っかからず、ちゃんと更新されること
    const yesterday = Date.now() - DAY;
    const u = await makeUser(yesterday);

    await hit(u.cookie);
    const v = await waitForChange(u.userId, yesterday);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(yesterday);
    expect(v!).toBeLessThanOrEqual(Date.now());
  });

  it("未認証リクエストでは何も起きない", async () => {
    const u = await makeUser();
    const res = await hit();
    expect(res.status).toBe(401);
    await sleep(100);
    expect(await lastSeen(u.userId)).toBeNull();

    // 存在しないセッションIDでも同じ
    const res2 = await hit(`eventer_session=${crypto.randomUUID()}`);
    expect(res2.status).toBe(401);
    await sleep(100);
    expect(await lastSeen(u.userId)).toBeNull();
  });

  it("退会申請中のユーザーでは更新されない", async () => {
    const u = await makeUser();
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), u.userId)
      .run();

    // 猶予期間中 (#250) は currentUser が null を返す（復帰案内の403）
    const res = await hit(u.cookie);
    expect(res.status).toBe(403);
    await sleep(100);
    expect(await lastSeen(u.userId)).toBeNull();
  });
});
