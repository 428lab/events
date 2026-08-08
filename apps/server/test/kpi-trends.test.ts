import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  KPI_METRICS,
  KPI_TREND_MIN_SAMPLE,
  type CommunityKpiPayload,
  type KpiPayload,
  type KpiSeriesPoint,
  addDays,
  kpiGranularity,
  kpiTrend,
  monthStart,
  toMonthly,
  toWeekly,
  weekStart,
} from "@eventer/shared";
import {
  MAX_SERIES_POINTS,
  fillDailySeries,
} from "../src/db/repositories/kpi.js";

/** KPI の推移 (#266)。
 *   1. 前期間比（サーバーが返す previous と、方向つきの見せ方）
 *   2. 時系列（日次の穴埋め・DAU/MAU・週次まとめ）
 *
 * データの形は本番と揃える（イベント作成時に作成者の staff メンバー行を作る）。
 * これを省くと「主催しただけの人が参加者に数えられる」類のバグを検出できない。 */

const BASE = "https://example.com";
const DAY = 86400000;

/** JST の 'YYYY-MM-DD'（サーバーの jd() と同じ基準） */
function jstDay(at: number): string {
  return new Date(at + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** N日前の JST 日付。日次系列・user_active_day の day 列と同じ基準 */
function dayAgo(n: number): string {
  return jstDay(Date.now() - n * DAY);
}

async function makeUser(
  opts: { admin?: boolean; createdAt?: number } = {},
): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, NULL)",
  )
    .bind(
      uid,
      opts.admin ? "dev-user" : `t:${uid}`,
      `u_${uid.slice(0, 8)}`,
      opts.createdAt ?? Date.now(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

async function makeCommunity(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, `c-${id.slice(0, 8)}`, `community_${id.slice(0, 4)}`, ownerId, Date.now())
    .run();
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
  )
    .bind(crypto.randomUUID(), id, ownerId, Date.now())
    .run();
  return id;
}

/** イベントを1件作る（作成者の staff 行つき＝本番と同じ形） */
async function makeEvent(opts: {
  createdBy: string;
  endsAt: number;
  communityId?: string;
  createdAt?: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = opts.createdAt ?? opts.endsAt;
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type,
       status, created_by, created_at, attendance_check, scheduling, community_id)
     VALUES (?, ?, '', ?, ?, 'online', 'published', ?, ?, 0, 0, ?)`,
  )
    .bind(
      id,
      `e_${id.slice(0, 8)}`,
      opts.endsAt - 3600000,
      opts.endsAt,
      opts.createdBy,
      createdAt,
      opts.communityId ?? null,
    )
    .run();
  await join({ eventId: id, userId: opts.createdBy, role: "staff", createdAt });
  return id;
}

async function join(opts: {
  eventId: string;
  userId: string;
  role?: string;
  status?: string;
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

/** 閲覧UU（visitor cookie で日次重複排除された1行） */
async function addUniqueView(
  eventId: string,
  day: string,
  visitorId: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_view_unique (event_id, day, visitor_id) VALUES (?, ?, ?)",
  )
    .bind(eventId, day, visitorId)
    .run();
}

/** 表示回数（流入元ごとの日次集計） */
async function addViewStat(
  eventId: string,
  day: string,
  source: string,
  views: number,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_view_stat (event_id, day, source, country, views) VALUES (?, ?, ?, 'XX', ?)",
  )
    .bind(eventId, day, source, views)
    .run();
}

async function addAudit(action: string, at: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_log (id, action, actor_user_id, actor_handle, target_user_id, target_handle, detail, created_at) VALUES (?, ?, NULL, '', NULL, '', '', ?)",
  )
    .bind(crypto.randomUUID(), action, at)
    .run();
}

async function makeVenue(ownerId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO venue (id, owner_id, name, created_at, updated_at) VALUES (?, ?, 'v', ?, ?)",
  )
    .bind(id, ownerId, Date.now(), Date.now())
    .run();
  return id;
}

async function makeOffer(
  venueId: string,
  createdBy: string,
  createdAt: number,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO venue_offer (id, venue_id, event_id, direction, status, created_by, created_at) VALUES (?, ?, NULL, 'venue_to_event', 'pending', ?, ?)",
  )
    .bind(crypto.randomUUID(), venueId, createdBy, createdAt)
    .run();
}

/** たまご（イベントのリクエスト） */
async function makeEgg(createdBy: string, createdAt: number): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_request (id, title, description, status, created_by, created_at) VALUES (?, ?, '', 'open', ?, ?)",
  )
    .bind(id, `egg_${id.slice(0, 6)}`, createdBy, createdAt)
    .run();
  return id;
}

async function reactEgg(
  requestId: string,
  userId: string,
  kind: "attend" | "host",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO event_request_reaction (request_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(requestId, userId, kind, Date.now())
    .run();
}

async function markActive(day: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_active_day (day, user_id) VALUES (?, ?)",
  )
    .bind(day, userId)
    .run();
}

async function getKpi(cookie: string, days?: number): Promise<KpiPayload> {
  const res = await SELF.fetch(
    `${BASE}/api/admin/kpi${days ? `?days=${days}` : ""}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as KpiPayload;
}

async function getCommunityKpi(
  communityId: string,
  cookie: string,
  days?: number,
): Promise<CommunityKpiPayload> {
  const res = await SELF.fetch(
    `${BASE}/api/communities/${communityId}/kpi${days ? `?days=${days}` : ""}`,
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as CommunityKpiPayload;
}

/* ---------------- 1. 増減の計算と方向 ---------------- */

describe("前期間比の計算", () => {
  it("増加・減少・横ばいで変化率と良し悪しが決まる", () => {
    const up = kpiTrend("participations", 142, 118)!;
    expect(up.ratio).toBeCloseTo((142 - 118) / 118, 10);
    expect(up.tone).toBe("good");

    const down = kpiTrend("participations", 100, 120)!;
    expect(down.ratio).toBeCloseTo(-1 / 6, 10);
    expect(down.tone).toBe("bad");

    const flat = kpiTrend("participations", 100, 100)!;
    expect(flat.ratio).toBe(0);
    expect(flat.tone).toBe("flat");
  });

  it("前期間が0のときは Infinity を出さず「新規」にする", () => {
    const t = kpiTrend("participations", 40, 0)!;
    expect(t.ratio).toBeNull();
    expect(t.isNew).toBe(true);
    expect(t.tone).toBe("good");
    expect(Number.isFinite(t.ratio ?? 0)).toBe(true);
  });

  it("今期間も前期間も0なら変化なし（新規にしない）", () => {
    const t = kpiTrend("participations", 0, 0)!;
    expect(t.isNew).toBe(false);
    expect(t.ratio).toBeNull();
    expect(t.tone).toBe("flat");
  });

  it("母数が小さいときは変化率を出さない（前期間の値は出す）", () => {
    // しきい値は定数相対ではなくリテラルで固定する。KPI_TREND_MIN_SAMPLE を
    // 使って書くと、定数を変えてもテストが一緒にずれて何も検出しない
    expect(KPI_TREND_MIN_SAMPLE).toBe(5);
    const few = kpiTrend("participations", 4, 1)!;
    expect(few.ratio).toBeNull();
    expect(few.isNew).toBe(false);
    expect(few.tone).toBe("flat");
    expect(few.previous).toBe(1);

    // どちらかが閾値（5）に届いていれば出す
    const enough = kpiTrend("participations", 5, 1)!;
    expect(enough.ratio).toBeCloseTo(4, 10);
  });

  it("全期間（前期間なし）は何も出さない", () => {
    expect(kpiTrend("participations", 10, undefined)).toBeNull();
  });

  it("率はポイント差で出す（率の相対変化率は誤読するので出さない）", () => {
    const t = kpiTrend("attendanceRate", 0.8, 0.75)!;
    expect(t.ratio).toBeNull();
    expect(t.diff).toBeCloseTo(0.05, 10);
    expect(t.tone).toBe("good");
    // 率は分母0・母数不足でサーバーが null を返す。そのときは増減も出さない
    const none = kpiTrend("attendanceRate", null, 0.75)!;
    expect(none.diff).toBeNull();
    expect(none.tone).toBe("flat");
  });
});

describe("減ったら良い指標は色が反転する", () => {
  const DOWN_IS_GOOD = [
    "cancelRate",
    "noShowRate",
    "dudRate",
    "dormantRate",
    "lateCancelRate",
    "topHostShare",
    "deleteRequested",
    "deleteCompleted",
  ] as const;

  it("定義が down になっている", () => {
    for (const key of DOWN_IS_GOOD) {
      expect(KPI_METRICS[key].direction).toBe("down");
    }
  });

  it("キャンセル率が下がったら good・上がったら bad", () => {
    expect(kpiTrend("cancelRate", 0.1, 0.2)!.tone).toBe("good");
    expect(kpiTrend("cancelRate", 0.3, 0.2)!.tone).toBe("bad");
    // 増えて良い指標は逆になっていること（取り違えの検出）
    expect(kpiTrend("attendanceRate", 0.1, 0.2)!.tone).toBe("bad");
    expect(kpiTrend("attendanceRate", 0.3, 0.2)!.tone).toBe("good");
  });

  it("退会数（件数）も減ったら good", () => {
    expect(kpiTrend("deleteRequested", 2, 10)!.tone).toBe("good");
    expect(kpiTrend("deleteRequested", 12, 10)!.tone).toBe("bad");
  });

  it("文脈で意味が変わる指標は色を付けない", () => {
    expect(KPI_METRICS.registrations.direction).toBe("neutral");
    expect(kpiTrend("registrations", 100, 10)!.tone).toBe("flat");
    expect(kpiTrend("registrations", 10, 100)!.tone).toBe("flat");
  });
});

/* ---------------- 2. サーバーが返す前期間の値 ---------------- */

describe("KPI: 前期間の集計", () => {
  it("横ばいのデータでは前期間比が 0% になる（期間の日数が揃っている）", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();

    // 今日から15日前まで、毎日ちょうど1件ずつ開催した完全に横ばいのデータ。
    // 7日指定なら 今期間 [7日前, 今日] の8日ぶん・前期間 [15日前, 8日前] の8日ぶんで、
    // どちらも 8 件になる。前期間を days 日（8日 対 7日）にすると、横ばいでも
    // +14.3% と出て「増えている」と誤読させる（30日指定なら +3.3%）
    for (let i = 0; i <= 15; i++) {
      await makeEvent({
        createdBy: host.userId,
        // 「今日」ぶんも開催済みにする必要があるので、いまより少しだけ前に終える
        endsAt: Date.now() - i * DAY - 1000,
      });
    }

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.northStar.heldEvents).toBe(8);
    expect(kpi.previous!.heldEvents).toBe(8);
    expect(kpi.previousSinceDay).toBe(dayAgo(15));
    // 参加体験（1件につき主催の1人）と作成数も同じく横ばい
    expect(kpi.northStar.participations).toBe(8);
    expect(kpi.previous!.participations).toBe(8);
    expect(kpi.organizers.createdEvents).toBe(8);
    expect(kpi.previous!.createdEvents).toBe(8);

    const trend = kpiTrend(
      "heldEvents",
      kpi.northStar.heldEvents,
      kpi.previous!.heldEvents,
    )!;
    expect(trend.ratio).toBe(0);
    expect(trend.tone).toBe("flat");
  });

  it("同じ長さのひとつ前の期間を別立てで数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const p1 = await makeUser();
    const p2 = await makeUser();
    const p3 = await makeUser();

    // 今期間（3日前に終了）: 参加者3人 + 主催 = 4
    const cur = await makeEvent({ createdBy: host.userId, endsAt: Date.now() - 3 * DAY });
    await join({ eventId: cur, userId: p1.userId });
    await join({ eventId: cur, userId: p2.userId });
    await join({ eventId: cur, userId: p3.userId });

    // 前期間（10日前に終了 = 7日指定なら [15日前, 7日前)）: 参加者1人 + 主催 = 2
    const prev = await makeEvent({ createdBy: host.userId, endsAt: Date.now() - 10 * DAY });
    await join({ eventId: prev, userId: p1.userId });

    // さらに前（20日前）: 7日指定ではどちらの期間にも入らない
    const old = await makeEvent({ createdBy: host.userId, endsAt: Date.now() - 20 * DAY });
    await join({ eventId: old, userId: p2.userId });

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.northStar.participations).toBe(4);
    expect(kpi.northStar.heldEvents).toBe(1);
    expect(kpi.previous).not.toBeNull();
    expect(kpi.previous!.participations).toBe(2);
    expect(kpi.previous!.heldEvents).toBe(1);
    expect(kpi.previousSinceDay).toBe(dayAgo(15));

    // 主催者は同じ1人。実人数なので期間ごとに1
    expect(kpi.organizers.hosts).toBe(1);
    expect(kpi.previous!.hosts).toBe(1);

    // 前期間比の見せ方（母数が小さいので率は出さないが前期間の値は出る）
    const trend = kpiTrend("participations", kpi.northStar.participations, kpi.previous!.participations)!;
    expect(trend.previous).toBe(2);
    expect(trend.ratio).toBeNull();
  });

  it("全期間は前期間が存在しないので null を返す", async () => {
    const admin = await makeUser({ admin: true });
    const kpi = await getKpi(admin.cookie);
    expect(kpi.days).toBeNull();
    expect(kpi.previous).toBeNull();
    expect(kpi.previousSinceDay).toBeNull();
  });

  it("キャンセル率は前期間ぶんも登録の作成日で切って算出する", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const users = [];
    for (let i = 0; i < 10; i++) users.push(await makeUser());

    const ev = await makeEvent({ createdBy: host.userId, endsAt: Date.now() - DAY });
    // 今期間: 10件中1件が取消 → 10%
    for (let i = 0; i < 10; i++) {
      await join({
        eventId: ev,
        userId: users[i]!.userId,
        createdAt: Date.now() - 2 * DAY,
        status: i === 0 ? "canceled" : "confirmed",
        canceledAt: i === 0 ? Date.now() - 2 * DAY : undefined,
      });
    }
    // 前期間: 10件中5件が取消 → 50%
    const ev2 = await makeEvent({ createdBy: host.userId, endsAt: Date.now() - 9 * DAY });
    for (let i = 0; i < 10; i++) {
      await join({
        eventId: ev2,
        userId: users[i]!.userId,
        createdAt: Date.now() - 9 * DAY,
        status: i < 5 ? "canceled" : "confirmed",
        canceledAt: i < 5 ? Date.now() - 9 * DAY : undefined,
      });
    }

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.participants.cancelRate).toBeCloseTo(0.1, 10);
    expect(kpi.previous!.cancelRate).toBeCloseTo(0.5, 10);

    // 減って良い指標なので「良くなった」側になる
    const trend = kpiTrend("cancelRate", kpi.participants.cancelRate, kpi.previous!.cancelRate)!;
    expect(trend.diff).toBeCloseTo(-0.4, 10);
    expect(trend.tone).toBe("good");
  });

  it("イベント作成時の staff 行を前期間でも参加登録に数えない", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const p1 = await makeUser();

    // 前期間に作られたイベント（作成者の staff 行つき）と参加登録1件
    const ev = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 9 * DAY,
      createdAt: Date.now() - 9 * DAY,
    });
    await join({ eventId: ev, userId: p1.userId, createdAt: Date.now() - 9 * DAY });

    const kpi = await getKpi(admin.cookie, 7);
    // staff 行を数えていたら 2 になる
    expect(kpi.previous!.registrations).toBe(1);
    expect(kpi.participants.registrations).toBe(0);
  });

  /* 以下は「前期間の列が今期間と同じ数え方になっているか」を、クエリごとに
   * 実際の値で押さえるもの。prev_* の列は SQL の字面どおりの ? 並びに依存していて、
   * バインドを1つずらしても今期間の値は正しいまま前期間だけ静かに壊れる。 */

  it("閲覧UU・表示回数の前期間を閲覧日で切って数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const ev = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 2 * DAY,
    });

    // 今期間（2日前）: UU 2人・表示 5回
    await addUniqueView(ev, dayAgo(2), "v1");
    await addUniqueView(ev, dayAgo(2), "v2");
    await addViewStat(ev, dayAgo(2), "direct", 5);
    // 前期間（10日前 = 7日指定なら [15日前, 7日前)）: UU 3人・表示 30回
    await addUniqueView(ev, dayAgo(10), "p1");
    await addUniqueView(ev, dayAgo(10), "p2");
    await addUniqueView(ev, dayAgo(10), "p3");
    await addViewStat(ev, dayAgo(10), "direct", 30);
    // どちらの期間にも入らない（20日前）
    await addUniqueView(ev, dayAgo(20), "o1");
    await addViewStat(ev, dayAgo(20), "direct", 100);

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.participants.uniqueViewers).toBe(2);
    expect(kpi.participants.totalViews).toBe(5);
    expect(kpi.previous!.uniqueViewers).toBe(3);
    expect(kpi.previous!.totalViews).toBe(30);
  });

  it("新規登録数の前期間を登録日で切って数える", async () => {
    const admin = await makeUser({ admin: true });
    // 前期間（10日前）に3人
    for (let i = 0; i < 3; i++) {
      await makeUser({ createdAt: Date.now() - 10 * DAY });
    }
    // 今期間（2日前）に1人。admin 自身も今日の作成なので今期間に入る
    await makeUser({ createdAt: Date.now() - 2 * DAY });
    // どちらの期間にも入らない（20日前）
    await makeUser({ createdAt: Date.now() - 20 * DAY });

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.retention.signups).toBe(2);
    expect(kpi.previous!.signups).toBe(3);
  });

  it("アクティベーション率は前期間比の対象にしない", async () => {
    const admin = await makeUser({ admin: true });
    const kpi = await getKpi(admin.cookie, 7);
    const prev = kpi.previous as unknown as Record<string, unknown>;
    // 分子が「これまでに1度でも参加/主催したか」で期間の縛りが無く、前期間に
    // 登録した人ほど猶予が長い。横ばいでも必ず「悪化」に寄るので値ごと出さない
    expect(prev.activationParticipantRate).toBeUndefined();
    expect(prev.activationHostRate).toBeUndefined();
    // 同じセクションの新規登録数は比較対象のまま（丸ごと落ちていないことの確認）
    expect(prev.signups).toBeDefined();
  });

  it("退会・復帰の件数の前期間を監査ログの日付で切って数える", async () => {
    const admin = await makeUser({ admin: true });
    await addAudit("account_delete_requested", Date.now() - 2 * DAY);
    await addAudit("account_delete_requested", Date.now() - 10 * DAY);
    await addAudit("account_delete_requested", Date.now() - 11 * DAY);
    await addAudit("account_restore", Date.now() - 10 * DAY);
    await addAudit("account_delete_completed", Date.now() - 3 * DAY);
    // どちらの期間にも入らない（20日前）
    await addAudit("account_delete_requested", Date.now() - 20 * DAY);

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.health.deleteRequested).toBe(1);
    expect(kpi.health.deleteCompleted).toBe(1);
    expect(kpi.health.restored).toBe(0);
    expect(kpi.previous!.deleteRequested).toBe(2);
    expect(kpi.previous!.deleteCompleted).toBe(0);
    expect(kpi.previous!.restored).toBe(1);
  });

  it("会場オファー・たまご・賛同の前期間をそれぞれの作成日で切って数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const fan1 = await makeUser();
    const fan2 = await makeUser();
    const venue = await makeVenue(host.userId);

    // 会場オファー: 今期間1件 / 前期間2件
    await makeOffer(venue, host.userId, Date.now() - 2 * DAY);
    await makeOffer(venue, host.userId, Date.now() - 10 * DAY);
    await makeOffer(venue, host.userId, Date.now() - 11 * DAY);
    await makeOffer(venue, host.userId, Date.now() - 20 * DAY);

    // たまご: 今期間1件 / 前期間2件。賛同は「たまごの作成日」で期間に振り分ける
    await makeEgg(host.userId, Date.now() - 2 * DAY);
    const prevEgg = await makeEgg(host.userId, Date.now() - 10 * DAY);
    await makeEgg(host.userId, Date.now() - 11 * DAY);
    await makeEgg(host.userId, Date.now() - 20 * DAY);
    await reactEgg(prevEgg, fan1.userId, "attend");
    await reactEgg(prevEgg, fan2.userId, "attend");
    await reactEgg(prevEgg, fan1.userId, "host");

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.matching.venueOffers).toBe(1);
    expect(kpi.previous!.venueOffers).toBe(2);
    expect(kpi.matching.eggs).toBe(1);
    expect(kpi.previous!.eggs).toBe(2);
    expect(kpi.matching.eggAttendReactions).toBe(0);
    // 賛同（参加したい2 + 開催してもいい1）は前期間のたまごに付いている
    expect(kpi.previous!.eggReactions).toBe(3);
  });
});

describe("コミュニティKPI: 前期間の集計", () => {
  it("前期間の開催・参加を返し、全期間では null", async () => {
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const p1 = await makeUser();
    const p2 = await makeUser();

    const cur = await makeEvent({
      createdBy: owner.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    await join({ eventId: cur, userId: p1.userId });
    await join({ eventId: cur, userId: p2.userId });

    const prev = await makeEvent({
      createdBy: owner.userId,
      endsAt: Date.now() - 40 * DAY,
      communityId: cid,
    });
    await join({ eventId: prev, userId: p1.userId });

    const kpi = await getCommunityKpi(cid, owner.cookie, 30);
    expect(kpi.northStar.heldEvents).toBe(1);
    expect(kpi.northStar.participations).toBe(3); // 参加2 + 主催1
    expect(kpi.previous!.heldEvents).toBe(1);
    expect(kpi.previous!.participations).toBe(2); // 参加1 + 主催1

    const all = await getCommunityKpi(cid, owner.cookie);
    expect(all.previous).toBeNull();
  });

  it("両方の期間に参加した人は、どちらの期間でも「参加した」に数える", async () => {
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const member = await makeUser();
    await env.DB.prepare(
      "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)",
    )
      .bind(crypto.randomUUID(), cid, member.userId, Date.now())
      .run();

    const cur = await makeEvent({
      createdBy: owner.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    await join({ eventId: cur, userId: member.userId });
    const prev = await makeEvent({
      createdBy: owner.userId,
      endsAt: Date.now() - 40 * DAY,
      communityId: cid,
    });
    await join({ eventId: prev, userId: member.userId });

    const kpi = await getCommunityKpi(cid, owner.cookie, 30);
    // 期間フラグの MAX で潰すと今期間が 0 になる（前期間フラグ2に負ける）
    expect(kpi.dormant.activeMembers).toBe(1);
    expect(kpi.previous!.activeMembers).toBe(1);
  });
});

/* ---------------- 3. 時系列 ---------------- */

describe("KPI: 日次推移", () => {
  it("活動が無かった日も 0 で埋めて連続した日付で返す", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const p1 = await makeUser();
    const ev = await makeEvent({ createdBy: host.userId, endsAt: Date.now() - 2 * DAY });
    await join({ eventId: ev, userId: p1.userId });

    const kpi = await getKpi(admin.cookie, 7);
    const daily = kpi.retention.daily;
    expect(daily.length).toBe(8); // 開始日〜今日
    expect(daily[0]!.day).toBe(dayAgo(7));
    expect(daily.at(-1)!.day).toBe(dayAgo(0));
    // 日付が1日ずつ連続していること
    for (let i = 1; i < daily.length; i++) {
      const gap =
        Date.parse(`${daily[i]!.day}T00:00:00Z`) -
        Date.parse(`${daily[i - 1]!.day}T00:00:00Z`);
      expect(gap).toBe(DAY);
    }
    const held = daily.find((d) => d.day === dayAgo(2))!;
    expect(held.heldEvents).toBe(1);
    expect(held.participations).toBe(2); // 参加1 + 主催1
    // 開催の無かった日は 0（欠測ではない）
    expect(daily.find((d) => d.day === dayAgo(3))!.heldEvents).toBe(0);
    expect(daily.find((d) => d.day === dayAgo(3))!.participations).toBe(0);
  });

  it("DAU/MAU をアクセス記録から算出し、計測開始より前は null にする", async () => {
    const admin = await makeUser({ admin: true });
    const u1 = await makeUser();
    const u2 = await makeUser();
    const u3 = await makeUser();

    // 計測開始は3日前。2日前はアクセスなし
    await markActive(dayAgo(3), u1.userId);
    await markActive(dayAgo(3), u2.userId);
    await markActive(dayAgo(1), u1.userId);
    await markActive(dayAgo(0), u3.userId);

    const kpi = await getKpi(admin.cookie, 7);
    expect(kpi.activeMeasuredFrom).toBe(dayAgo(3));
    const by = new Map(kpi.retention.daily.map((d) => [d.day, d]));

    // 計測開始より前は「0人」ではなく「まだ計測していない」
    expect(by.get(dayAgo(5))!.dau).toBeNull();
    expect(by.get(dayAgo(5))!.mau).toBeNull();

    expect(by.get(dayAgo(3))!.dau).toBe(2);
    expect(by.get(dayAgo(3))!.mau).toBe(2);
    // アクセスが無かった日: DAU は 0 だが MAU（直近30日）は落ちない
    expect(by.get(dayAgo(2))!.dau).toBe(0);
    expect(by.get(dayAgo(2))!.mau).toBe(2);
    expect(by.get(dayAgo(1))!.dau).toBe(1);
    expect(by.get(dayAgo(1))!.mau).toBe(2);
    // 今日は u3 と、この画面を見ている管理者自身のアクセスが記録される
    // （認証を通ったリクエストで user_active_day に入る #257）
    expect(by.get(dayAgo(0))!.dau).toBe(2);
    expect(by.get(dayAgo(0))!.mau).toBe(4);
  });

  it("MAU のローリング窓はちょうど直近30日（29日前は入り30日前は入らない）", async () => {
    const admin = await makeUser({ admin: true });
    const u29 = await makeUser();
    const u30 = await makeUser();
    const u40 = await makeUser();
    // 境界ちょうどに置く。「3日前と40日前」のようなデータだけだと窓を
    // 28日にしても35日にしても値が変わらず、窓の広さを何も固定できない
    await markActive(dayAgo(29), u29.userId);
    await markActive(dayAgo(30), u30.userId);
    await markActive(dayAgo(40), u40.userId);

    const kpi = await getKpi(admin.cookie, 7);
    const by = new Map(kpi.retention.daily.map((d) => [d.day, d]));

    // 今日の窓は [29日前, 今日]。29日前ちょうどは入り、30日前は外れる。
    // 残るのは 29日前の人と、画面を見ている管理者自身（アクセスが今日として
    // 記録される #257）。窓が28日なら1人、30日以上なら3人になる
    expect(by.get(dayAgo(0))!.dau).toBe(1);
    expect(by.get(dayAgo(0))!.mau).toBe(2);
    // 1日前の窓は [30日前, 1日前]。30日前ちょうどが入り、管理者は入らない
    expect(by.get(dayAgo(1))!.dau).toBe(0);
    expect(by.get(dayAgo(1))!.mau).toBe(2);
    // 7日前の窓は [36日前, 7日前]。40日前の人はまだ入らない（窓が35日だと入る）
    expect(by.get(dayAgo(7))!.mau).toBe(2);
  });

  it("まとめて表示する長さでは MAU を期末（週の最終日・月末）だけ算出する", async () => {
    // MAU は1日ぶん出すのに直近30日を引き当てるので、日次で全日ぶん出すと
    // 走査量が 日数 × 30 × DAU になる。画面がまとめる長さのときは期末だけ
    // 算出し、間の日は「算出していない」= null で返す。期末は週次なら日曜、
    // 月次なら月末 (#292)。月末を落とすと月別の MAU が月内の最後の日曜の値になる
    const admin = await makeUser({ admin: true });
    const u = await makeUser();
    await markActive(dayAgo(89), u.userId);

    const kpi = await getKpi(admin.cookie, 90);
    const daily = kpi.retention.daily;
    expect(daily.length).toBe(91);
    const isSunday = (day: string) =>
      new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
    const isMonthEnd = (day: string) => addDays(day, 1).endsWith("-01");
    const measured = daily.filter((d) => d.day >= dayAgo(89));
    // 90日あれば月末は必ず含まれる（この分岐が効いていることの確認）
    expect(measured.filter((d) => isMonthEnd(d.day) && !isSunday(d.day)).length)
      .toBeGreaterThan(0);
    for (const d of measured) {
      if (isSunday(d.day) || isMonthEnd(d.day)) expect(d.mau).not.toBeNull();
      else expect(d.mau).toBeNull();
      // DAU は週・月の平均に畳むので日次のまま必要
      expect(d.dau).not.toBeNull();
    }

    // 週次・月次にまとめると MAU は期末の値になり、欠けない
    const points = measured.map((d) => ({
      day: d.day,
      values: { mau: d.mau, dau: d.dau },
    }));
    const opts = { lastKeys: ["mau"], averageKeys: ["dau"] };
    const weekly = toWeekly(points, opts);
    expect(weekly.length).toBeGreaterThan(0);
    expect(weekly.every((w) => w.values.mau !== null)).toBe(true);
    const monthly = toMonthly(points, opts);
    expect(monthly.length).toBeGreaterThan(0);
    expect(monthly.every((m) => m.values.mau !== null)).toBe(true);
  });

  it("コミュニティKPIも開催と参加の日次推移を返す", async () => {
    const owner = await makeUser();
    const cid = await makeCommunity(owner.userId);
    const p1 = await makeUser();
    const ev = await makeEvent({
      createdBy: owner.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    await join({ eventId: ev, userId: p1.userId });

    const kpi = await getCommunityKpi(cid, owner.cookie, 30);
    expect(kpi.daily.length).toBe(31);
    const d = kpi.daily.find((x) => x.day === dayAgo(2))!;
    expect(d.heldEvents).toBe(1);
    expect(d.participations).toBe(2);
    expect(kpi.daily.find((x) => x.day === dayAgo(3))!.heldEvents).toBe(0);
  });
});

describe("日次系列の上限", () => {
  it("長すぎる期間は古い側を切り、直近を必ず残す", () => {
    // ?days=3650 のような指定でも点数には上限がある。古い日から詰めて途中で
    // 打ち切ると**新しい側**が落ち、直近ぶんが警告も無くグラフから消える
    const today = "2026-08-07";
    const out = fillDailySeries("2000-01-01", today, [], []);
    expect(out.length).toBe(MAX_SERIES_POINTS);
    expect(out.at(-1)!.day).toBe(today);
    expect(out[0]!.day).toBe(addDays(today, -(MAX_SERIES_POINTS - 1)));
  });

  it("上限に収まる期間はそのまま返す", () => {
    const out = fillDailySeries("2026-08-01", "2026-08-07", [], []);
    expect(out.map((p) => p.day)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });
});

describe("時系列の粒度", () => {
  it("30日以下は日次・90日は週次・半年超は月次", () => {
    expect(kpiGranularity(8)).toBe("day");
    expect(kpiGranularity(31)).toBe("day");
    expect(kpiGranularity(60)).toBe("day");
    expect(kpiGranularity(61)).toBe("week");
    expect(kpiGranularity(91)).toBe("week");
    // 180日（≒26週）までが週次。1年を週次で並べると52本になって形が読めない (#292)
    expect(kpiGranularity(180)).toBe("week");
    expect(kpiGranularity(181)).toBe("month");
    expect(kpiGranularity(366)).toBe("month");
  });

  it("週次は月曜始まりで、端の欠けた週を落とす", () => {
    // 2026-01-05 は月曜。火曜(01-06)から3週間ぶん並べる
    const points: KpiSeriesPoint[] = [];
    for (let i = 0; i < 20; i++) {
      const day = new Date(Date.parse("2026-01-06T12:00:00Z") + i * DAY)
        .toISOString()
        .slice(0, 10);
      points.push({ day, values: { joins: 1, dau: 10, mau: 100 + i } });
    }
    expect(weekStart("2026-01-06")).toBe("2026-01-05");

    const weekly = toWeekly(points, { averageKeys: ["dau"], lastKeys: ["mau"] });
    // 01-05 の週は火曜始まりで6日ぶんしか無い → 落ちる。
    // 01-12 と 01-19 の週が残り、01-26 の週も途中で切れて落ちる
    expect(weekly.map((w) => w.day)).toEqual(["2026-01-12", "2026-01-19"]);
    // 件数は合計、DAU は平均、MAU は週の最終日の値
    expect(weekly[0]!.values.joins).toBe(7);
    expect(weekly[0]!.values.dau).toBe(10);
    expect(weekly[0]!.values.mau).toBe(112); // 01-18 = i:12 → 100+12
  });

  it("未計測（null）の日が混ざっても週次で 0 と取り違えない", () => {
    const points: KpiSeriesPoint[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.parse("2026-01-05T12:00:00Z") + i * DAY)
        .toISOString()
        .slice(0, 10);
      points.push({ day, values: { joins: 2, dau: null } });
    }
    const weekly = toWeekly(points, { averageKeys: ["dau"] });
    expect(weekly.length).toBe(1);
    expect(weekly[0]!.values.joins).toBe(14);
    expect(weekly[0]!.values.dau).toBeNull();
  });

  /** 月次まとめ (#292)。週次と**同じ畳み方**（合計／平均／期末）で、
   * 端の欠けた月は出さない。月の日数が揃っていないぶん、完全かどうかの判定が
   * 週次より間違えやすいので固定する。 */
  it("月次は暦月ごとで、端の欠けた月を落とす", () => {
    // 2026-01-20 〜 2026-04-10。1月は20日始まりで欠け、4月は10日で切れる
    const points: KpiSeriesPoint[] = [];
    for (let day = "2026-01-20"; day <= "2026-04-10"; day = addDays(day, 1)) {
      points.push({
        day,
        values: { joins: 1, dau: 10, mau: 100 + points.length },
      });
    }
    expect(monthStart("2026-02-17")).toBe("2026-02-01");

    const monthly = toMonthly(points, {
      averageKeys: ["dau"],
      lastKeys: ["mau"],
    });
    expect(monthly.map((m) => m.day)).toEqual(["2026-02-01", "2026-03-01"]);
    // 件数は合計（2月は28日・3月は31日）、DAU は平均、MAU は月末の値
    expect(monthly[0]!.values.joins).toBe(28);
    expect(monthly[1]!.values.joins).toBe(31);
    expect(monthly[0]!.values.dau).toBe(10);
    expect(monthly[0]!.values.mau).toBe(139); // 02-28 = i:39 → 100+39
    expect(monthly[1]!.values.mau).toBe(170); // 03-31 = i:70 → 100+70
  });

  it("うるう年の2月は29日そろって初めて出す", () => {
    const feb = (n: number): KpiSeriesPoint[] => {
      const out: KpiSeriesPoint[] = [];
      for (let i = 1; i <= n; i++) {
        out.push({
          day: `2028-02-${String(i).padStart(2, "0")}`,
          values: { joins: 1 },
        });
      }
      return out;
    };
    // 2028 はうるう年。28日ぶんでは「1日足りない月」なので出さない
    expect(toMonthly(feb(28)).length).toBe(0);
    expect(toMonthly(feb(29)).map((m) => m.values.joins)).toEqual([29]);
  });

  it("月次でも未計測（null）の月は 0 と取り違えない", () => {
    // 計測開始前の月は値が無い。合計 0 にすると「誰も居なかった月」に見える
    const points: KpiSeriesPoint[] = [];
    for (let day = "2026-02-01"; day <= "2026-03-31"; day = addDays(day, 1)) {
      points.push({
        day,
        values: { joins: 2, dau: day >= "2026-03-01" ? 5 : null },
      });
    }
    const monthly = toMonthly(points, { averageKeys: ["dau"] });
    expect(monthly.map((m) => m.day)).toEqual(["2026-02-01", "2026-03-01"]);
    expect(monthly[0]!.values.dau).toBeNull();
    expect(monthly[0]!.values.joins).toBe(56);
    expect(monthly[1]!.values.dau).toBe(5);
  });
});
