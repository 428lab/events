import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  ABUSE_THRESHOLDS as T,
  type AbuseFlagsPayload,
  type DetectAbuseResult,
} from "@eventer/shared";

/** 異常行動の検知 (#259 PR2)。しきい値ちょうど/未満/超過の境界値を中心に検証する。
 *
 * 本番のデータ形状を再現すること: イベント作成時には作成者の staff メンバー行が
 * 必ず作られる (POST /events が eventMembersRepo.add(..., "staff") をする)。
 * これを再現しないと「参加者0のイベント」判定や「キャンセル率」の母数が
 * 実データとずれ、欠陥を検出できない。 */

const BASE = "https://example.com";
const HOUR = 3600000;
const DAY = 86400000;
const CRON_KEY = "test-cron-secret";

/** ユーザーを1人作る（セッション付き）。
 * admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる。
 * createdAt を既定で60日前にしているのは、new_account_burst（登録24時間以内の
 * 大量作成）が意図せず発火して他ルールの検証を汚さないようにするため */
async function makeUser(
  opts: {
    admin?: boolean;
    createdAt?: number;
    deletedAt?: number | null;
  } = {},
): Promise<{ userId: string; cookie: string; handle: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const handle = `u_${uid.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
  )
    .bind(
      uid,
      opts.admin ? "dev-user" : `t:${uid}`,
      handle,
      opts.createdAt ?? Date.now() - 60 * DAY,
      opts.deletedAt ?? null,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}`, handle };
}

/** セッションを作らない軽量版（新規登録の急増の母数づくり用） */
async function makeSignup(createdAt: number): Promise<void> {
  const uid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(uid, `t:${uid}`, `u_${uid.slice(0, 8)}`, createdAt)
    .run();
}

/** イベントを1件作る。本番と同じく作成者の staff メンバー行もあわせて作る */
async function makeEvent(opts: {
  createdBy: string;
  status?: string;
  createdAt?: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = opts.createdAt ?? Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type,
       status, created_by, created_at)
     VALUES (?, ?, '', ?, ?, 'online', ?, ?, ?)`,
  )
    .bind(
      id,
      `e_${id.slice(0, 8)}`,
      createdAt + DAY,
      createdAt + DAY + HOUR,
      opts.status ?? "published",
      opts.createdBy,
      createdAt,
    )
    .run();
  await join({
    eventId: id,
    userId: opts.createdBy,
    role: "staff",
    createdAt,
  });
  return id;
}

async function join(opts: {
  eventId: string;
  userId: string;
  status?: string;
  role?: string;
  createdAt?: number;
  canceledAt?: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, created_at, status,
       attended, canceled_at, canceled_scheduling)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.eventId,
      opts.userId,
      opts.role ?? "participant",
      opts.createdAt ?? Date.now(),
      opts.status ?? "confirmed",
      opts.canceledAt ?? null,
    )
    .run();
}

async function makeEgg(createdBy: string, createdAt: number): Promise<void> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_request (id, title, description, status, created_by, created_at, slug)
     VALUES (?, ?, '', 'open', ?, ?, ?)`,
  )
    .bind(id, `r_${id.slice(0, 8)}`, createdBy, createdAt, id.slice(0, 8))
    .run();
}

async function makeComment(
  eventId: string,
  userId: string,
  createdAt: number,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_comment (id, event_id, user_id, body, created_at) VALUES (?, ?, ?, 'x', ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, createdAt)
    .run();
}

async function makeLike(
  eventId: string,
  userId: string,
  createdAt: number,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_like (id, event_id, user_id, kind, target_key, created_at) VALUES (?, ?, ?, 'event', '', ?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, createdAt)
    .run();
}

/** cron エンドポイント経由で検知バッチを走らせる */
async function runDetect(): Promise<DetectAbuseResult> {
  const res = await SELF.fetch(`${BASE}/api/cron/detect-abuse`, {
    method: "POST",
    headers: { "x-cron-key": CRON_KEY },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as DetectAbuseResult;
}

/** 検知バッチを走らせ、指定ルールの新規記録件数を返す */
async function detectCount(rule: string): Promise<number> {
  const r = await runDetect();
  expect(r.failedRules).toEqual([]);
  return r.byRule[rule] ?? 0;
}

/** そのユーザー宛の abuse_flag の件数 */
async function flagCount(rule: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(1) AS n FROM abuse_flag WHERE rule = ? AND subject_user_id = ?",
  )
    .bind(rule, userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// -------------------------------------------------------------------------
// 認可
// -------------------------------------------------------------------------

describe("検知バッチの認可", () => {
  it("cron キーが無ければ 403", async () => {
    const res = await SELF.fetch(`${BASE}/api/cron/detect-abuse`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("cron キーが違えば 403", async () => {
    const res = await SELF.fetch(`${BASE}/api/cron/detect-abuse`, {
      method: "POST",
      headers: { "x-cron-key": "wrong-key" },
    });
    expect(res.status).toBe(403);
  });

  it("正しい cron キーなら 200", async () => {
    const res = await SELF.fetch(`${BASE}/api/cron/detect-abuse`, {
      method: "POST",
      headers: { "x-cron-key": CRON_KEY },
    });
    expect(res.status).toBe(200);
  });

  it("手動実行は未ログインなら 401", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/run-detect-abuse`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("手動実行は運営管理者でなければ 403", async () => {
    const u = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/admin/run-detect-abuse`, {
      method: "POST",
      headers: { cookie: u.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("手動実行は運営管理者なら 200（クエリ本数も返す）", async () => {
    const admin = await makeUser({ admin: true });
    const res = await SELF.fetch(`${BASE}/api/admin/run-detect-abuse`, {
      method: "POST",
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetectAbuseResult;
    expect(body.recorded).toBe(0);
    expect(body.failedRules).toEqual([]);
    // ルール7本 + 重複判定1 + 掃除1。Workers のサブリクエスト上限(50)に十分収まる
    expect(body.queries).toBeLessThanOrEqual(20);
  });
});

// -------------------------------------------------------------------------
// ルールごとの境界値
// -------------------------------------------------------------------------

describe("event_burst: イベントの大量作成", () => {
  it(`24時間で ${T.eventBurst.shortMin - 1} 件では検知しない`, async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eventBurst.shortMin - 1; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: Date.now() - i * HOUR,
      });
    }
    expect(await detectCount("event_burst")).toBe(0);
  });

  it(`24時間で ${T.eventBurst.shortMin} 件ちょうどで検知する`, async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eventBurst.shortMin; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: Date.now() - i * HOUR,
      });
    }
    expect(await detectCount("event_burst")).toBe(1);
    expect(await flagCount("event_burst", u.userId)).toBe(1);
  });

  it("24時間より前のイベントは短期の判定に入らない", async () => {
    const u = await makeUser();
    // 全部 30時間前 → 24時間の窓には入らない。7日で 15 件にも届かない
    for (let i = 0; i < T.eventBurst.shortMin + 2; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: Date.now() - 30 * HOUR - i * 1000,
      });
    }
    expect(await detectCount("event_burst")).toBe(0);
  });

  it(`7日で ${T.eventBurst.longMin - 1} 件では検知せず、${T.eventBurst.longMin} 件で検知する`, async () => {
    const few = await makeUser();
    // 1日あたり 2件（24時間のしきい値 5 未満）を分散させる
    for (let i = 0; i < T.eventBurst.longMin - 1; i++) {
      await makeEvent({
        createdBy: few.userId,
        status: "draft",
        createdAt: Date.now() - (12 * HOUR + i * 8 * HOUR),
      });
    }
    expect(await detectCount("event_burst")).toBe(0);

    const many = await makeUser();
    for (let i = 0; i < T.eventBurst.longMin; i++) {
      await makeEvent({
        createdBy: many.userId,
        status: "draft",
        createdAt: Date.now() - (12 * HOUR + i * 8 * HOUR),
      });
    }
    expect(await detectCount("event_burst")).toBe(1);
    expect(await flagCount("event_burst", many.userId)).toBe(1);
  });

  it("detail に件数が入り、個人情報は入らない", async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eventBurst.shortMin; i++) {
      await makeEvent({ createdBy: u.userId, status: "draft" });
    }
    await runDetect();
    const row = await env.DB.prepare(
      "SELECT subject_handle, detail FROM abuse_flag WHERE rule = 'event_burst' AND subject_user_id = ?",
    )
      .bind(u.userId)
      .first<{ subject_handle: string; detail: string }>();
    expect(row?.subject_handle).toBe(u.handle);
    const detail = JSON.parse(row?.detail ?? "{}") as Record<string, unknown>;
    expect(detail.dayCount).toBe(T.eventBurst.shortMin);
    // 件数と期間だけ。タイトル・本文の類は入れない
    expect(Object.keys(detail).sort()).toEqual([
      "dayCount",
      "weekCount",
      "windowDays",
    ]);
  });
});

describe("egg_burst: たまごの大量投稿", () => {
  it(`${T.eggBurst.min - 1} 件では検知しない`, async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eggBurst.min - 1; i++) {
      await makeEgg(u.userId, Date.now() - i * HOUR);
    }
    expect(await detectCount("egg_burst")).toBe(0);
  });

  it(`${T.eggBurst.min} 件ちょうどで検知する`, async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eggBurst.min; i++) {
      await makeEgg(u.userId, Date.now() - i * HOUR);
    }
    expect(await detectCount("egg_burst")).toBe(1);
  });

  it("窓の外（24時間より前）は数えない", async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eggBurst.min + 3; i++) {
      await makeEgg(u.userId, Date.now() - 2 * DAY - i * 1000);
    }
    expect(await detectCount("egg_burst")).toBe(0);
  });
});

describe("comment_burst: コメント・いいねの連投", () => {
  /** 同じ1時間バケットに収まる時刻（バケットはエポック基準の固定境界） */
  function bucketBase(): number {
    return Math.floor((Date.now() - 3 * HOUR) / HOUR) * HOUR + 60000;
  }

  it(`1時間で ${T.commentBurst.min - 1} 件では検知しない`, async () => {
    const u = await makeUser();
    const host = await makeUser();
    const ev = await makeEvent({ createdBy: host.userId });
    const base = bucketBase();
    for (let i = 0; i < T.commentBurst.min - 1; i++) {
      await makeComment(ev, u.userId, base + i * 1000);
    }
    expect(await detectCount("comment_burst")).toBe(0);
  });

  it(`1時間で ${T.commentBurst.min} 件ちょうどで検知する（コメント＋いいねの合算）`, async () => {
    const u = await makeUser();
    const host = await makeUser();
    const ev = await makeEvent({ createdBy: host.userId });
    const ev2 = await makeEvent({ createdBy: host.userId });
    const base = bucketBase();
    for (let i = 0; i < T.commentBurst.min - 2; i++) {
      await makeComment(ev, u.userId, base + i * 1000);
    }
    // いいねは (event, user, kind, target_key) が一意なのでイベントを分ける
    await makeLike(ev, u.userId, base + 60000);
    await makeLike(ev2, u.userId, base + 61000);
    expect(await detectCount("comment_burst")).toBe(1);
  });

  it("別々の時間に散っていれば検知しない", async () => {
    const u = await makeUser();
    const host = await makeUser();
    const ev = await makeEvent({ createdBy: host.userId });
    // 合計はしきい値を超えるが、1時間あたりは超えない
    for (let i = 0; i < T.commentBurst.min * 2; i++) {
      await makeComment(ev, u.userId, Date.now() - (i + 1) * 40 * 60 * 1000);
    }
    expect(await detectCount("comment_burst")).toBe(0);
  });
});

describe("new_account_burst: 新規アカウントの即時大量行動", () => {
  it(`登録24時間以内に ${T.newAccountBurst.min - 1} 件では検知しない`, async () => {
    const at = Date.now() - 2 * DAY;
    const u = await makeUser({ createdAt: at });
    for (let i = 0; i < T.newAccountBurst.min - 1; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: at + HOUR + i * 1000,
      });
    }
    expect(await detectCount("new_account_burst")).toBe(0);
  });

  it(`登録24時間以内に ${T.newAccountBurst.min} 件ちょうどで検知する`, async () => {
    const at = Date.now() - 2 * DAY;
    const u = await makeUser({ createdAt: at });
    for (let i = 0; i < T.newAccountBurst.min; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: at + HOUR + i * 1000,
      });
    }
    expect(await detectCount("new_account_burst")).toBe(1);
  });

  it("登録から24時間より後の作成は数えない", async () => {
    const at = Date.now() - 5 * DAY;
    const u = await makeUser({ createdAt: at });
    for (let i = 0; i < T.newAccountBurst.min + 2; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: at + 2 * DAY + i * 1000,
      });
    }
    expect(await detectCount("new_account_burst")).toBe(0);
  });

  it("古い登録（lookback の外）は毎日は見直さない", async () => {
    const at = Date.now() - 60 * DAY;
    const u = await makeUser({ createdAt: at });
    for (let i = 0; i < T.newAccountBurst.min + 2; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: at + HOUR + i * 1000,
      });
    }
    expect(await detectCount("new_account_burst")).toBe(0);
  });
});

describe("empty_event_spam: 参加者0のイベント量産", () => {
  /** 24時間の窓に入らないよう2日以上前に分散させる */
  function spreadAt(i: number): number {
    return Date.now() - (2 * DAY + i * HOUR);
  }

  it(`参加者0が ${T.emptyEventSpam.min - 1} 件では検知しない`, async () => {
    const u = await makeUser();
    for (let i = 0; i < T.emptyEventSpam.min - 1; i++) {
      await makeEvent({ createdBy: u.userId, createdAt: spreadAt(i) });
    }
    expect(await detectCount("empty_event_spam")).toBe(0);
  });

  it(`参加者0が ${T.emptyEventSpam.min} 件ちょうどで検知する（作成者の staff 行は参加者に数えない）`, async () => {
    const u = await makeUser();
    for (let i = 0; i < T.emptyEventSpam.min; i++) {
      await makeEvent({ createdBy: u.userId, createdAt: spreadAt(i) });
    }
    expect(await detectCount("empty_event_spam")).toBe(1);
  });

  it("参加者がいるイベントは数えない", async () => {
    const u = await makeUser();
    const guest = await makeUser();
    for (let i = 0; i < T.emptyEventSpam.min; i++) {
      const ev = await makeEvent({ createdBy: u.userId, createdAt: spreadAt(i) });
      // 1件だけ参加者あり → 参加者0は min-1 件で未達
      if (i === 0) await join({ eventId: ev, userId: guest.userId });
    }
    expect(await detectCount("empty_event_spam")).toBe(0);
  });

  it("下書きは対象外（公開したのに0人、が趣旨）", async () => {
    const u = await makeUser();
    for (let i = 0; i < T.emptyEventSpam.min + 2; i++) {
      await makeEvent({
        createdBy: u.userId,
        status: "draft",
        createdAt: spreadAt(i),
      });
    }
    expect(await detectCount("empty_event_spam")).toBe(0);
  });
});

describe("cancel_burst: 大量キャンセル", () => {
  /** 参加登録を n 件、うち canceled 件をキャンセル済みにする。
   * イベント自体は60日前に作られたことにして、他ルールの巻き込みを避ける */
  async function joinAndCancel(
    userId: string,
    total: number,
    canceled: number,
  ): Promise<void> {
    const host = await makeUser();
    for (let i = 0; i < total; i++) {
      const ev = await makeEvent({
        createdBy: host.userId,
        createdAt: Date.now() - 60 * DAY,
      });
      await join({
        eventId: ev,
        userId,
        status: i < canceled ? "canceled" : "confirmed",
        canceledAt: i < canceled ? Date.now() - HOUR : undefined,
      });
    }
  }

  it(`キャンセル ${T.cancelBurst.min - 1} 件（率は十分高い）では検知しない`, async () => {
    const u = await makeUser();
    await joinAndCancel(u.userId, T.cancelBurst.min - 1, T.cancelBurst.min - 1);
    expect(await detectCount("cancel_burst")).toBe(0);
  });

  it(`キャンセル ${T.cancelBurst.min} 件かつ率 ${T.cancelBurst.minRate} ちょうどで検知する`, async () => {
    const u = await makeUser();
    const total = Math.round(T.cancelBurst.min / T.cancelBurst.minRate);
    await joinAndCancel(u.userId, total, T.cancelBurst.min);
    expect(await detectCount("cancel_burst")).toBe(1);
  });

  it("件数を満たしても率が低ければ検知しない", async () => {
    const u = await makeUser();
    // 率 = min / (min*3) ≒ 0.33 < minRate
    await joinAndCancel(u.userId, T.cancelBurst.min * 3, T.cancelBurst.min);
    expect(await detectCount("cancel_burst")).toBe(0);
  });

  it("主催者本人の staff 行は母数に入らない", async () => {
    const u = await makeUser();
    // 主催として staff 行だけを大量に作っても、キャンセル0なので検知されない
    for (let i = 0; i < T.cancelBurst.min * 2; i++) {
      await makeEvent({ createdBy: u.userId, createdAt: Date.now() - 60 * DAY });
    }
    expect(await detectCount("cancel_burst")).toBe(0);
  });
});

describe("signup_spike: 全体の登録急増", () => {
  const { baselineDays, ratio, min } = T.signupSpike;
  /** 直近 baselineDays 日に perDay 人/日、対象日(昨日)に target 人 */
  async function seed(perDay: number, target: number): Promise<void> {
    for (let d = 2; d < baselineDays + 2; d++) {
      for (let i = 0; i < perDay; i++) {
        await makeSignup(Date.now() - d * DAY);
      }
    }
    for (let i = 0; i < target; i++) {
      await makeSignup(Date.now() - DAY);
    }
  }

  it("最低件数に届かなければ検知しない", async () => {
    await seed(0, min - 1);
    expect(await detectCount("signup_spike")).toBe(0);
  });

  it("最低件数ちょうど・平均0なら検知する（subject はサービス全体＝NULL）", async () => {
    await seed(0, min);
    expect(await detectCount("signup_spike")).toBe(1);
    const row = await env.DB.prepare(
      "SELECT subject_user_id, subject_handle, detail FROM abuse_flag WHERE rule = 'signup_spike'",
    ).first<{
      subject_user_id: string | null;
      subject_handle: string;
      detail: string;
    }>();
    expect(row?.subject_user_id).toBeNull();
    expect(row?.subject_handle).toBe("");
    expect((JSON.parse(row?.detail ?? "{}") as { signups: number }).signups).toBe(
      min,
    );
  });

  it("平均の ratio 倍に届かなければ検知しない", async () => {
    // 平均 4 人/日 → しきい値は 12 人。11 人（最低件数は満たす）では発火しない
    const perDay = 4;
    await seed(perDay, perDay * ratio - 1);
    expect(await detectCount("signup_spike")).toBe(0);
  });

  it("平均の ratio 倍ちょうどで検知する", async () => {
    const perDay = 4;
    await seed(perDay, perDay * ratio);
    expect(await detectCount("signup_spike")).toBe(1);
  });
});

// -------------------------------------------------------------------------
// 共通の制約
// -------------------------------------------------------------------------

describe("退会申請中ユーザーは検知対象外", () => {
  it("deleted_at があるユーザーはイベントを量産しても記録されない", async () => {
    const u = await makeUser({ deletedAt: Date.now() - HOUR });
    for (let i = 0; i < T.eventBurst.shortMin + 3; i++) {
      await makeEvent({ createdBy: u.userId, createdAt: Date.now() - i * 1000 });
    }
    const r = await runDetect();
    expect(r.byRule.event_burst).toBe(0);
    expect(r.byRule.empty_event_spam).toBe(0);
    expect(await flagCount("event_burst", u.userId)).toBe(0);
  });

  it("退会申請中ユーザーのたまご・コメントも対象外", async () => {
    const u = await makeUser({ deletedAt: Date.now() - HOUR });
    const host = await makeUser();
    const ev = await makeEvent({ createdBy: host.userId });
    for (let i = 0; i < T.eggBurst.min + 2; i++) {
      await makeEgg(u.userId, Date.now() - i * 1000);
    }
    const base = Math.floor((Date.now() - 3 * HOUR) / HOUR) * HOUR + 60000;
    for (let i = 0; i < T.commentBurst.min + 2; i++) {
      await makeComment(ev, u.userId, base + i * 1000);
    }
    const r = await runDetect();
    expect(r.byRule.egg_burst).toBe(0);
    expect(r.byRule.comment_burst).toBe(0);
  });
});

describe("クールダウン期間内の重複はスキップされる", () => {
  it("2回目の実行では同じ subject × rule を記録しない", async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eventBurst.shortMin; i++) {
      await makeEvent({ createdBy: u.userId, status: "draft" });
    }
    const first = await runDetect();
    expect(first.byRule.event_burst).toBe(1);
    expect(first.skipped).toBe(0);

    const second = await runDetect();
    expect(second.byRule.event_burst).toBe(0);
    expect(second.recorded).toBe(0);
    expect(second.skipped).toBe(1);
    // 記録は増えていない
    expect(await flagCount("event_burst", u.userId)).toBe(1);
  });

  it("クールダウンを過ぎた記録は抑制しない", async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eventBurst.shortMin; i++) {
      await makeEvent({ createdBy: u.userId, status: "draft" });
    }
    await runDetect();
    // 既存の記録をクールダウン期間より前にずらす
    await env.DB.prepare("UPDATE abuse_flag SET detected_at = ?")
      .bind(Date.now() - 30 * DAY)
      .run();
    const again = await runDetect();
    expect(again.byRule.event_burst).toBe(1);
    expect(await flagCount("event_burst", u.userId)).toBe(2);
  });

  it("別ルールなら同じユーザーでも記録される", async () => {
    const u = await makeUser();
    for (let i = 0; i < T.eventBurst.shortMin; i++) {
      await makeEvent({ createdBy: u.userId, status: "draft" });
    }
    for (let i = 0; i < T.eggBurst.min; i++) {
      await makeEgg(u.userId, Date.now() - i * HOUR);
    }
    const r = await runDetect();
    expect(r.byRule.event_burst).toBe(1);
    expect(r.byRule.egg_burst).toBe(1);
    expect(r.recorded).toBe(2);
  });
});

describe("運営への通知", () => {
  it("1回のバッチで1通にまとまる（ルール別のサマリ入り）", async () => {
    const admin = await makeUser({ admin: true });
    const u = await makeUser();
    // 2ルール・2ユーザーぶんを1回のバッチで検知させる
    for (let i = 0; i < T.eventBurst.shortMin; i++) {
      await makeEvent({ createdBy: u.userId, status: "draft" });
    }
    for (let i = 0; i < T.eggBurst.min; i++) {
      await makeEgg(u.userId, Date.now() - i * HOUR);
    }
    const other = await makeUser();
    for (let i = 0; i < T.eggBurst.min; i++) {
      await makeEgg(other.userId, Date.now() - i * HOUR);
    }

    const r = await runDetect();
    expect(r.recorded).toBe(3);
    expect(r.notified).toBe(1);

    const rows = await env.DB.prepare(
      "SELECT type, title, body, link FROM notification WHERE user_id = ?",
    )
      .bind(admin.userId)
      .all<{ type: string; title: string; body: string; link: string }>();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].type).toBe("abuse_flag");
    expect(rows.results[0].title).toContain("3");
    expect(rows.results[0].body).toContain("イベントの大量作成: 1件");
    expect(rows.results[0].body).toContain("たまごの大量投稿: 2件");
    // リンク先は要確認リストの画面
    expect(rows.results[0].link).toBe("/admin/abuse");
  });

  it("新規の記録が無ければ通知しない", async () => {
    const admin = await makeUser({ admin: true });
    const r = await runDetect();
    expect(r.recorded).toBe(0);
    expect(r.notified).toBe(0);
    const row = await env.DB.prepare(
      "SELECT COUNT(1) AS n FROM notification WHERE user_id = ?",
    )
      .bind(admin.userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

// -------------------------------------------------------------------------
// 要確認リスト API
// -------------------------------------------------------------------------

/** abuse_flag を直接1件作る（一覧APIの検証用） */
async function insertFlag(opts: {
  rule?: string;
  subjectUserId?: string | null;
  detectedAt?: number;
  reviewedAt?: number | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO abuse_flag (id, rule, subject_user_id, subject_handle, detail, detected_at, reviewed_at, reviewed_by)
     VALUES (?, ?, ?, 'someone', '{"count":9}', ?, ?, NULL)`,
  )
    .bind(
      id,
      opts.rule ?? "event_burst",
      opts.subjectUserId ?? null,
      opts.detectedAt ?? Date.now(),
      opts.reviewedAt ?? null,
    )
    .run();
  return id;
}

async function listFlags(
  cookie: string,
  query = "",
): Promise<AbuseFlagsPayload> {
  const res = await SELF.fetch(`${BASE}/api/admin/abuse-flags${query}`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as AbuseFlagsPayload;
}

describe("GET /api/admin/abuse-flags", () => {
  it("未ログインは 401、非管理者は 403", async () => {
    expect((await SELF.fetch(`${BASE}/api/admin/abuse-flags`)).status).toBe(401);
    const u = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/admin/abuse-flags`, {
      headers: { cookie: u.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("未確認が上・その中では新しい順", async () => {
    const admin = await makeUser({ admin: true });
    const oldReviewed = await insertFlag({
      detectedAt: Date.now(),
      reviewedAt: Date.now(),
    });
    const older = await insertFlag({ detectedAt: Date.now() - 2 * HOUR });
    const newer = await insertFlag({ detectedAt: Date.now() - HOUR });

    const data = await listFlags(admin.cookie);
    expect(data.flags.map((f) => f.id)).toEqual([newer, older, oldReviewed]);
    expect(data.total).toBe(3);
    expect(data.unreviewed).toBe(2);
  });

  it("reviewed で絞り込める（unreviewed は絞り込みに影響されない）", async () => {
    const admin = await makeUser({ admin: true });
    await insertFlag({});
    await insertFlag({});
    const reviewed = await insertFlag({ reviewedAt: Date.now() });

    const un = await listFlags(admin.cookie, "?reviewed=0");
    expect(un.total).toBe(2);
    expect(un.flags.every((f) => f.reviewedAt === null)).toBe(true);
    expect(un.unreviewed).toBe(2);

    const done = await listFlags(admin.cookie, "?reviewed=1");
    expect(done.total).toBe(1);
    expect(done.flags[0].id).toBe(reviewed);
    expect(done.unreviewed).toBe(2);

    const all = await listFlags(admin.cookie, "?reviewed=");
    expect(all.total).toBe(3);
  });

  it("ページングできる", async () => {
    const admin = await makeUser({ admin: true });
    const total = 3;
    for (let i = 0; i < total; i++) {
      await insertFlag({ detectedAt: Date.now() - i * HOUR });
    }
    const p1 = await listFlags(admin.cookie, "?page=1");
    expect(p1.page).toBe(1);
    expect(p1.total).toBe(total);
    expect(p1.flags.length).toBe(total);
    // 1ページの件数を超える page は空になる（0除算やエラーにはしない）
    const p2 = await listFlags(admin.cookie, "?page=2");
    expect(p2.page).toBe(2);
    expect(p2.flags.length).toBe(0);
    // 不正な page は 1 として扱う
    const bad = await listFlags(admin.cookie, "?page=abc");
    expect(bad.page).toBe(1);
  });

  it("未確認件数のバッジ用エンドポイント", async () => {
    const admin = await makeUser({ admin: true });
    await insertFlag({});
    await insertFlag({ reviewedAt: Date.now() });
    const res = await SELF.fetch(`${BASE}/api/admin/abuse-flags/unread-count`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 });
  });
});

describe("POST /api/admin/abuse-flags/:id/review", () => {
  it("非管理者は 403", async () => {
    const u = await makeUser();
    const id = await insertFlag({});
    const res = await SELF.fetch(
      `${BASE}/api/admin/abuse-flags/${id}/review`,
      { method: "POST", headers: { cookie: u.cookie } },
    );
    expect(res.status).toBe(403);
  });

  it("確認済みにすると reviewed_at/reviewed_by が入り、一覧から外れる", async () => {
    const admin = await makeUser({ admin: true });
    const id = await insertFlag({});
    const res = await SELF.fetch(
      `${BASE}/api/admin/abuse-flags/${id}/review`,
      { method: "POST", headers: { cookie: admin.cookie } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: true });

    const row = await env.DB.prepare(
      "SELECT reviewed_at, reviewed_by FROM abuse_flag WHERE id = ?",
    )
      .bind(id)
      .first<{ reviewed_at: number | null; reviewed_by: string | null }>();
    expect(row?.reviewed_at).toBeGreaterThan(0);
    expect(row?.reviewed_by).toBe(admin.userId);

    const un = await listFlags(admin.cookie, "?reviewed=0");
    expect(un.total).toBe(0);
    expect(un.unreviewed).toBe(0);
  });

  it("既に確認済み・存在しないIDでも 200（updated=false）", async () => {
    const admin = await makeUser({ admin: true });
    const id = await insertFlag({ reviewedAt: Date.now() });
    const res = await SELF.fetch(
      `${BASE}/api/admin/abuse-flags/${id}/review`,
      { method: "POST", headers: { cookie: admin.cookie } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, updated: false });

    const missing = await SELF.fetch(
      `${BASE}/api/admin/abuse-flags/does-not-exist/review`,
      { method: "POST", headers: { cookie: admin.cookie } },
    );
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ ok: false, updated: false });
  });
});
