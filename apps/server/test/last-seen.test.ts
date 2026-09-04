import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  bindEnv,
  runWithExecutionContext,
  type Env,
} from "../src/runtime.js";
import { usersRepo } from "../src/db/repositories/users.js";
import {
  jstDay,
  recordLastSeen,
  shouldTouchLastSeen,
} from "../src/lib/lastSeen.js";

/** アクセス記録 (#257)。DAU/MAU 計測の土台。
 * - user.last_seen_at … 最終アクセス時刻（休眠の判定用）
 * - user_active_day   … その日アクセスした事実（過去日まで遡る推移・コホート用）
 * 「JSTの日付が変わった最初の1回だけ書く」ことが肝で、ここが崩れると
 * 全リクエストで D1 への書き込みが増える */

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

async function activeDays(userId: string): Promise<string[]> {
  const r = await env.DB.prepare(
    "SELECT day FROM user_active_day WHERE user_id = ? ORDER BY day",
  )
    .bind(userId)
    .all<{ day: string }>();
  return r.results.map((x) => x.day);
}

/** 認証つきの普通のリクエスト（currentUser を通る経路なら何でもよい）。
 * SELF.fetch ではなく worker.fetch を直接叩くのは、waitOnExecutionContext で
 * waitUntil の完了を待てるようにするため。sleep 待ちだと遅いCIで
 * 「書き込まれないこと」の検証が偽グリーンになり得る */
async function hit(cookie?: string): Promise<Response> {
  const { default: worker } = await import("../src/worker.js");
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${BASE}/api/auth/me`, {
      headers: cookie ? { cookie } : {},
    }),
    env as never,
    ctx,
  );
  // ここが返った時点で waitUntil のバックグラウンド書き込みも完了している
  await waitOnExecutionContext(ctx);
  return res;
}

/** JST で「今日」の 00:01 の epoch ms（同一日の別時刻を作るため） */
function jstTodayStart(now = Date.now()): number {
  return Math.floor((now + JST_OFFSET) / DAY) * DAY - JST_OFFSET + 60_000;
}

describe("アクセス記録 (#257)", () => {
  it("認証つきリクエストで last_seen_at と当日の user_active_day が入る", async () => {
    const u = await makeUser();
    const before = Date.now();
    const res = await hit(u.cookie);
    expect(res.status).toBe(200);

    const v = await lastSeen(u.userId);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThanOrEqual(before);
    expect(v!).toBeLessThanOrEqual(Date.now());
    // 日別の記録も同時に入る（last_seen_at だけでは過去日の推移が出せない）
    expect(await activeDays(u.userId)).toEqual([jstDay(v!)]);
  });

  it("同じJSTの日のうちは書き込みが走らない（値が変わらない）", async () => {
    // 今日の JST 00:01 を最終アクセスとして持つユーザー。
    // 「日付が変わったときだけ」の判定が効いていれば一切書き換わらない
    const sameDay = jstTodayStart();
    const u = await makeUser(sameDay);

    for (let i = 0; i < 3; i += 1) {
      const res = await hit(u.cookie);
      expect(res.status).toBe(200);
    }
    expect(await lastSeen(u.userId)).toBe(sameDay);
    expect(await activeDays(u.userId)).toEqual([]);
  });

  it("初回アクセス後、同じ日の2回目では書き込みが走らない", async () => {
    const u = await makeUser();
    await hit(u.cookie);
    const first = await lastSeen(u.userId);
    expect(first).not.toBeNull();

    // 同じ JST 日の別時刻に書き換えてから叩く。更新が走れば now に上書きされる
    const sameDayEarlier = jstTodayStart();
    await env.DB.prepare("UPDATE user SET last_seen_at = ? WHERE id = ?")
      .bind(sameDayEarlier, u.userId)
      .run();

    await hit(u.cookie);
    expect(await lastSeen(u.userId)).toBe(sameDayEarlier);
  });

  it("同一アイソレートで記録済みなら、DBの値が古くても二度書きしない", async () => {
    // 1リクエスト内で currentUser が複数回呼ばれても書き込みを1回に抑えるための
    // アイソレート内キャッシュ（lib/lastSeen.ts の touchedDay）の検証。
    // DB の値を**昨日**に戻す＝DB由来の判定 (shouldTouchLastSeen) は通ってしまう
    // 状態を作り、それでも書かれないことを見る（キャッシュを外すと書かれて落ちる）
    const u = await makeUser();
    await hit(u.cookie);
    expect(await lastSeen(u.userId)).not.toBeNull();

    const yesterday = Date.now() - DAY;
    await env.DB.prepare("UPDATE user SET last_seen_at = ? WHERE id = ?")
      .bind(yesterday, u.userId)
      .run();
    await env.DB.prepare("DELETE FROM user_active_day WHERE user_id = ?")
      .bind(u.userId)
      .run();

    await hit(u.cookie);
    expect(await lastSeen(u.userId)).toBe(yesterday);
    expect(await activeDays(u.userId)).toEqual([]);
  });

  it("JSTの日付が変わったら記録され、user_active_day が日ごとに増える", async () => {
    // 前日にバックデートした状態のユーザー（＝昨日が最終アクセス）を用意する。
    // 「同一日の2回目」の抑止に引っかからず、ちゃんと記録されること
    const yesterday = Date.now() - DAY;
    const u = await makeUser(yesterday);
    await env.DB.prepare(
      "INSERT INTO user_active_day (day, user_id) VALUES (?, ?)",
    )
      .bind(jstDay(yesterday), u.userId)
      .run();

    await hit(u.cookie);
    const v = await lastSeen(u.userId);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(yesterday);
    expect(v!).toBeLessThanOrEqual(Date.now());
    // 昨日の行は残り、今日の行が増える（＝過去日の DAU が後から出せる）
    expect(await activeDays(u.userId)).toEqual([jstDay(yesterday), jstDay(v!)]);
  });

  it("未認証リクエストでは何も起きない", async () => {
    const u = await makeUser();
    const res = await hit();
    expect(res.status).toBe(401);
    expect(await lastSeen(u.userId)).toBeNull();

    // 存在しないセッションIDでも同じ
    const res2 = await hit(`eventer_session=${crypto.randomUUID()}`);
    expect(res2.status).toBe(401);
    expect(await lastSeen(u.userId)).toBeNull();
    expect(await activeDays(u.userId)).toEqual([]);
  });

  it("退会申請中のユーザーでは記録されない", async () => {
    const u = await makeUser();
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), u.userId)
      .run();

    // 猶予期間中 (#250) は currentUser が null を返す（復帰案内の403）
    const res = await hit(u.cookie);
    expect(res.status).toBe(403);
    expect(await lastSeen(u.userId)).toBeNull();
    expect(await activeDays(u.userId)).toEqual([]);
  });
});

describe("usersRepo.touchLastSeen (#257)", () => {
  it("退会申請中のユーザーは、直接呼んでも記録されない", async () => {
    // currentUser の判定より後（SELECT と書き込みの間）に退会した競合をカバーする
    // ための repo 側の条件 deleted_at IS NULL の検証。HTTP 経由だと currentUser が
    // 先に null を返してここまで来ないので、リポジトリを直接呼ぶ
    bindEnv(env as unknown as Env);
    const u = await makeUser();
    await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
      .bind(Date.now(), u.userId)
      .run();

    const now = Date.now();
    await usersRepo.touchLastSeen(u.userId, now, jstDay(now));

    expect(await lastSeen(u.userId)).toBeNull();
    expect(await activeDays(u.userId)).toEqual([]);
  });

  it("在籍中なら記録され、同じ日に何度呼んでも user_active_day は1行", async () => {
    bindEnv(env as unknown as Env);
    const u = await makeUser();
    const now = Date.now();

    await usersRepo.touchLastSeen(u.userId, now, jstDay(now));
    await usersRepo.touchLastSeen(u.userId, now + 1000, jstDay(now));

    expect(await lastSeen(u.userId)).toBe(now + 1000);
    expect(await activeDays(u.userId)).toEqual([jstDay(now)]);
  });
});

describe("recordLastSeen のバックグラウンド実行が失敗したとき (#257)", () => {
  it("waitUntil が投げても認証を壊さず、その日の記録も落ちない", async () => {
    // ExecutionContext は Worker ランタイムから渡ってくるもので、
    // 既に切れている等の理由で waitUntil が投げ得る。
    // そのとき「記録済み」の印が残ると、このアイソレートが生きている間
    // そのユーザーのその日の記録が二度と行われない
    const u = await makeUser();
    const now = Date.now();

    let deferred: Promise<unknown> | null = null;
    const broken = {
      waitUntil: (p: Promise<unknown>) => {
        deferred = p; // 検証を決定的にするため掴んでおく
        throw new Error("waitUntil boom");
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    bindEnv(env as unknown as Env);

    let thrown: unknown = null;
    try {
      await runWithExecutionContext(broken, () =>
        recordLastSeen(u.userId, null, now),
      );
    } catch (e) {
      thrown = e;
    }
    await deferred; // 走り出していた書き込みを確定させてから状態を作り直す

    // 記録が無かったことにして、もう一度アクセスさせる
    await env.DB.prepare("UPDATE user SET last_seen_at = NULL WHERE id = ?")
      .bind(u.userId)
      .run();
    await env.DB.prepare("DELETE FROM user_active_day WHERE user_id = ?")
      .bind(u.userId)
      .run();

    // 実行文脈を張らない＝その場で await
    await recordLastSeen(u.userId, null, now);
    // 印が取り消されていれば同じ日でも再試行されて記録が入る
    expect(await lastSeen(u.userId)).toBe(now);
    expect(await activeDays(u.userId)).toEqual([jstDay(now)]);
    // 呼び出し元（currentUser）に例外を漏らさない
    expect(thrown).toBeNull();
  });
});

describe("JST基準の日付判定 (#257)", () => {
  // 固定 epoch で判定する。実行時刻に依存させると、JST の日付境界を跨ぐ扱いを
  // 間違えても「たまたま通る」時間帯（深夜など）が出て見逃す
  const jst = (
    y: number,
    m: number,
    d: number,
    h: number,
    mi = 0,
    s = 0,
  ): number => Date.UTC(y, m - 1, d, h - 9, mi, s);

  it("jstDay は JST の暦日を返す（UTC の日付ではない）", () => {
    expect(jstDay(jst(2026, 8, 7, 23, 59, 59))).toBe("2026-08-07");
    expect(jstDay(jst(2026, 8, 8, 0, 0, 1))).toBe("2026-08-08");
    // JST 08-08 06:00 は UTC ではまだ 08-07 21:00
    expect(jstDay(jst(2026, 8, 8, 6, 0, 0))).toBe("2026-08-08");
  });

  it("JSTの日付を跨いだら true（UTCでは同じ日でも）", () => {
    // どちらも UTC では 2026-08-07。JST では 08-07 と 08-08 に分かれる
    expect(
      shouldTouchLastSeen(jst(2026, 8, 7, 23, 59, 59), jst(2026, 8, 8, 0, 0, 1)),
    ).toBe(true);
  });

  it("同じJSTの日なら false（UTCでは別の日でも）", () => {
    // JST 08-08 06:00 (UTC 08-07) と JST 08-08 12:00 (UTC 08-08)
    expect(
      shouldTouchLastSeen(jst(2026, 8, 8, 6, 0, 0), jst(2026, 8, 8, 12, 0, 0)),
    ).toBe(false);
  });

  it("last_seen_at が NULL（計測開始前からのユーザー）なら true", () => {
    expect(shouldTouchLastSeen(null, jst(2026, 8, 8, 12, 0, 0))).toBe(true);
  });
});
