import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  KPI_METRICS,
  KPI_TREND_MIN_SAMPLE,
  type CommunityKpiPayload,
  type KpiPayload,
  type KpiSeriesPoint,
  kpiGranularity,
  kpiTrend,
  toWeekly,
  weekStart,
} from "@eventer/shared";

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
  opts: { admin?: boolean } = {},
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
      Date.now(),
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
    const few = kpiTrend("participations", KPI_TREND_MIN_SAMPLE - 1, 1)!;
    expect(few.ratio).toBeNull();
    expect(few.isNew).toBe(false);
    expect(few.tone).toBe("flat");
    expect(few.previous).toBe(1);

    // どちらかが閾値に届いていれば出す
    const enough = kpiTrend("participations", KPI_TREND_MIN_SAMPLE, 1)!;
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

    // 前期間（10日前に終了 = 7日指定なら [14日前, 7日前)）: 参加者1人 + 主催 = 2
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
    expect(kpi.previousSinceDay).toBe(dayAgo(14));

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

  it("30日より前のアクセスは MAU のローリング窓から外れる", async () => {
    const admin = await makeUser({ admin: true });
    const oldUser = await makeUser();
    const nowUser = await makeUser();
    await markActive(dayAgo(40), oldUser.userId);
    await markActive(dayAgo(1), nowUser.userId);

    const kpi = await getKpi(admin.cookie, 7);
    const by = new Map(kpi.retention.daily.map((d) => [d.day, d]));
    // 40日前の人は窓（直近30日）の外。残るのは1日前の人と、
    // 画面を見ている管理者自身（アクセスが今日として記録される）
    expect(by.get(dayAgo(0))!.mau).toBe(2);
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

describe("時系列の粒度", () => {
  it("30日以下は日次・90日以上は週次", () => {
    expect(kpiGranularity(8)).toBe("day");
    expect(kpiGranularity(31)).toBe("day");
    expect(kpiGranularity(61)).toBe("week");
    expect(kpiGranularity(91)).toBe("week");
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
});
