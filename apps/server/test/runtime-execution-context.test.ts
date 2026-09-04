import { env } from "cloudflare:test";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  deferBackground,
  runWithExecutionContext,
  type Env,
} from "../src/runtime.js";
import worker from "../src/worker.js";
import * as reminders from "../src/lib/reminders.js";

/** waitUntil に渡された Promise を記録するだけの ExecutionContext */
function recordingCtx(): {
  ctx: ExecutionContext;
  seen: Promise<unknown>[];
} {
  const seen: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      seen.push(p);
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, seen };
}

const BASE = "https://example.com";
const DAY = 24 * 60 * 60 * 1000;

/** ユーザー1人＋セッションを作る。last_seen_at は NULL＝まだ一度も記録がない。
 * この状態で認証を通すと currentUser が必ず記録を1回 deferBackground する */
async function makeUser(): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, last_seen_at)
     VALUES (?, ?, ?, NULL, NULL, ?, NULL)`,
  )
    .bind(uid, `t:${uid}`, `t_${uid.slice(0, 8)}`, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("背景処理の実行文脈はリクエストごと (#317)", () => {
  it("A が待っている間に B が入っても、A の背景処理は A の ctx に付く", async () => {
    const a = recordingCtx();
    const b = recordingCtx();

    // A がネットワーク待ちに入ったことを B に知らせる関門
    let releaseA = (): void => {};
    const aReachedNetworkWait = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let letAContinue = (): void => {};
    const aMayContinue = new Promise<void>((resolve) => {
      letAContinue = resolve;
    });

    const workA = Promise.resolve("A の背景処理");
    const workB = Promise.resolve("B の背景処理");

    // リクエストA: 途中で待ちに入り、そのあと背景処理を積む
    const requestA = runWithExecutionContext(a.ctx, async () => {
      releaseA();
      await aMayContinue;
      await deferBackground(workA);
    });

    // リクエストB: A が待っている最中に丸ごと走りきる
    await aReachedNetworkWait;
    await runWithExecutionContext(b.ctx, async () => {
      await deferBackground(workB);
    });

    // B が終わってから A を再開させる
    letAContinue();
    await requestA;

    expect(a.seen).toEqual([workA]);
    expect(b.seen).toEqual([workB]);
  });

  it("実行文脈の外では waitUntil せずその場で待つ", async () => {
    let done = false;
    await deferBackground(
      (async () => {
        done = true;
      })(),
    );
    expect(done).toBe(true);
  });

  it("入れ子の文脈は内側が勝ち、抜ければ外側に戻る", async () => {
    const outer = recordingCtx();
    const inner = recordingCtx();
    const outerWork = Promise.resolve("outer");
    const innerWork = Promise.resolve("inner");

    await runWithExecutionContext(outer.ctx, async () => {
      await runWithExecutionContext(inner.ctx, () =>
        deferBackground(innerWork),
      );
      await deferBackground(outerWork);
    });

    expect(inner.seen).toEqual([innerWork]);
    expect(outer.seen).toEqual([outerWork]);
  });
});

/** 文脈を張っているのは worker.ts の2つの入口だけなので、
 * その2か所を直接押さえる。片方を外しても他のテストが気づかない状態にしない */
describe("Worker の入口が実行文脈を張る (#317)", () => {
  it("fetch: リクエスト中の背景処理はそのリクエストの ctx に載る", async () => {
    const u = await makeUser();
    const c = recordingCtx();

    // 認証を通すと currentUser がアクセス記録 (#257) を deferBackground する
    const res = await worker.fetch!(
      new Request(`${BASE}/api/auth/me`, { headers: { Cookie: u.cookie } }),
      env as unknown as Env,
      c.ctx,
    );
    expect(res.status).toBe(200);

    // 文脈が張られていなければ deferBackground はその場で await してしまい、
    // この ctx には何も載らない
    expect(c.seen.length).toBeGreaterThan(0);

    await Promise.all(c.seen);
    const row = await env.DB.prepare(
      "SELECT last_seen_at FROM user WHERE id = ?",
    )
      .bind(u.userId)
      .first<{ last_seen_at: number | null }>();
    expect(row?.last_seen_at).not.toBeNull();
  });

  it("scheduled: cron の中の背景処理は cron の ctx に載る", async () => {
    const c = recordingCtx();
    const work = Promise.resolve("cron の背景処理");
    vi.spyOn(reminders, "sendEventReminders").mockImplementation(async () => {
      await deferBackground(work);
      return 0;
    });

    await worker.scheduled!(
      {
        cron: "0 0 * * *",
        scheduledTime: Date.now(),
        noRetry: () => {},
      } as unknown as ScheduledController,
      env as unknown as Env,
      c.ctx,
    );

    // 文脈が張られていなければ work はその場で await され、ctx には
    // sendEventReminders() の外側の Promise しか載らない
    expect(c.seen).toContain(work);
  });
});
