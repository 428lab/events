import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  COMMUNITY_KPI_MIN_SAMPLE,
  STATS_MAX_DAYS,
  type CommunityKpiPayload,
  type KpiPayload,
} from "@eventer/shared";

const BASE = "https://example.com";
const DAY = 86400000;

/** ユーザーを1人作る（セッション付き）。
 * admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる */
async function makeUser(
  opts: { admin?: boolean; deletedAt?: number | null } = {},
): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
  )
    .bind(
      uid,
      opts.admin ? "dev-user" : `t:${uid}`,
      `u_${uid.slice(0, 8)}`,
      Date.now(),
      opts.deletedAt ?? null,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(sid, uid, Date.now() + DAY)
    .run();
  return { userId: uid, cookie: `eventer_session=${sid}` };
}

/** コミュニティを1つ作る。オーナーの community_member 行も作る
 * （communitiesRepo.create と同じ形。休眠会員率の分母に効くので必須） */
async function makeCommunity(ownerId: string): Promise<{
  id: string;
  slug: string;
}> {
  const id = crypto.randomUUID();
  const slug = `c-${id.slice(0, 8)}`;
  await env.DB.prepare(
    "INSERT INTO community (id, slug, name, description, owner_id, created_at) VALUES (?, ?, ?, '', ?, ?)",
  )
    .bind(id, slug, `community_${slug}`, ownerId, Date.now())
    .run();
  await addCommunityMember(id, ownerId, "owner");
  return { id, slug };
}

async function addCommunityMember(
  communityId: string,
  userId: string,
  role = "member",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO community_member (id, community_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), communityId, userId, role, Date.now())
    .run();
}

/** イベントを1件作る。本番と同じデータ形状にするため、作成者の staff メンバー行も
 * あわせて作る（POST /events が eventMembersRepo.add(..., "staff") をするため、
 * 実データでは必ず作成者の event_member 行が存在する）。
 * これを再現しないと「主催しただけの人が参加者に数えられる」類のバグを検出できない。 */
async function makeEvent(opts: {
  createdBy: string;
  communityId?: string | null;
  status?: string;
  startsAt?: number;
  endsAt?: number;
  attendanceCheck?: boolean;
  scheduling?: boolean;
  createdAt?: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  const endsAt = opts.endsAt ?? Date.now() - DAY;
  const createdAt = opts.createdAt ?? Date.now();
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type,
       status, created_by, created_at, attendance_check, scheduling, community_id)
     VALUES (?, ?, '', ?, ?, 'online', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `e_${id.slice(0, 8)}`,
      opts.startsAt ?? endsAt - 3600000,
      endsAt,
      opts.status ?? "published",
      opts.createdBy,
      createdAt,
      opts.attendanceCheck ? 1 : 0,
      opts.scheduling ? 1 : 0,
      opts.communityId ?? null,
    )
    .run();
  await join({ eventId: id, userId: opts.createdBy, role: "staff", createdAt });
  return id;
}

async function join(opts: {
  eventId: string;
  userId: string;
  status?: string;
  role?: string;
  attended?: boolean;
  createdAt?: number;
  canceledAt?: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, created_at, status,
       attended, canceled_at, canceled_scheduling)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      crypto.randomUUID(),
      opts.eventId,
      opts.userId,
      opts.role ?? "participant",
      opts.createdAt ?? Date.now(),
      opts.status ?? "confirmed",
      opts.attended ? 1 : 0,
      opts.canceledAt ?? null,
    )
    .run();
}

async function fetchKpi(
  communityId: string,
  cookie: string,
  days?: number,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/communities/${communityId}/kpi${days ? `?days=${days}` : ""}`,
    { headers: { cookie } },
  );
}

async function getKpi(
  communityId: string,
  cookie: string,
  days?: number,
): Promise<CommunityKpiPayload> {
  const res = await fetchKpi(communityId, cookie, days);
  expect(res.status).toBe(200);
  return (await res.json()) as CommunityKpiPayload;
}

describe("GET /api/communities/:id/kpi 認可", () => {
  it("未ログインは 401", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const res = await SELF.fetch(`${BASE}/api/communities/${c.id}/kpi`);
    expect(res.status).toBe(401);
  });

  it("コミュニティのオーナーは 200", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    expect((await fetchKpi(c.id, owner.cookie)).status).toBe(200);
  });

  it("コミュニティ管理者 (admin) は 200", async () => {
    const owner = await makeUser();
    const manager = await makeUser();
    const c = await makeCommunity(owner.userId);
    await addCommunityMember(c.id, manager.userId, "admin");
    expect((await fetchKpi(c.id, manager.cookie)).status).toBe(200);
  });

  it("一般メンバーは 403", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const c = await makeCommunity(owner.userId);
    await addCommunityMember(c.id, member.userId, "member");
    expect((await fetchKpi(c.id, member.cookie)).status).toBe(403);
  });

  it("非メンバーは 403", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const c = await makeCommunity(owner.userId);
    expect((await fetchKpi(c.id, stranger.cookie)).status).toBe(403);
  });

  it("他のコミュニティの管理者でも対象コミュニティの数字は見られない (403)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const c = await makeCommunity(owner.userId);
    await makeCommunity(other.userId);
    expect((await fetchKpi(c.id, other.cookie)).status).toBe(403);
  });

  it("運営管理者は非メンバーでも 200", async () => {
    const owner = await makeUser();
    const admin = await makeUser({ admin: true });
    const c = await makeCommunity(owner.userId);
    expect((await fetchKpi(c.id, admin.cookie)).status).toBe(200);
  });

  it("存在しないコミュニティは 404", async () => {
    const admin = await makeUser({ admin: true });
    const res = await fetchKpi(crypto.randomUUID(), admin.cookie);
    expect(res.status).toBe(404);
  });
});

describe("コミュニティKPI: データが無いとき", () => {
  it("ゼロ除算せず 200。率は null・件数は 0", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const kpi = await getKpi(c.id, owner.cookie, 30);

    expect(kpi.community.id).toBe(c.id);
    expect(kpi.community.slug).toBe(c.slug);
    expect(kpi.minSample).toBe(COMMUNITY_KPI_MIN_SAMPLE);
    expect(kpi.northStar.heldEvents).toBe(0);
    expect(kpi.northStar.participations).toBe(0);
    expect(kpi.northStar.avgParticipantsPerEvent).toBeNull();
    expect(kpi.participants.attendanceRate).toBeNull();
    expect(kpi.participants.noShowRate).toBeNull();
    expect(kpi.participants.cancelRate).toBeNull();
    expect(kpi.participants.repeatRate).toBeNull();
    expect(kpi.participants.viewToJoinRate).toBeNull();
    expect(kpi.organizers.dudRate).toBeNull();
    expect(kpi.organizers.repeatHostRate).toBeNull();
    expect(kpi.organizers.avgEventsPerHost).toBeNull();
    expect(kpi.organizers.topHostEvents).toBe(0);
    expect(kpi.organizers.topHostShare).toBeNull();
    expect(kpi.newcomers.participants).toBe(0);
    expect(kpi.newcomers.newcomerRate).toBeNull();
    // オーナー1人だけなので休眠率は母数不足で出さない
    expect(kpi.dormant.members).toBe(1);
    expect(kpi.dormant.dormantMembers).toBe(1);
    expect(kpi.dormant.dormantRate).toBeNull();
    expect(kpi.overlap).toEqual([]);

    const flat = JSON.stringify(kpi);
    expect(flat).not.toContain("NaN");
    expect(flat).not.toContain("Infinity");
  });

  it("?days の異常値でも 500 にせず全期間 or 上限で扱う", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);

    for (const q of ["0", "-1", "abc", ""]) {
      const res = await SELF.fetch(
        `${BASE}/api/communities/${c.id}/kpi?days=${q}`,
        { headers: { cookie: owner.cookie } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as CommunityKpiPayload;
      expect(body.days).toBeNull();
      expect(body.sinceDay).toBe("0000");
    }

    const huge = await SELF.fetch(
      `${BASE}/api/communities/${c.id}/kpi?days=1e9`,
      { headers: { cookie: owner.cookie } },
    );
    expect(huge.status).toBe(200);
    const hugeBody = (await huge.json()) as CommunityKpiPayload;
    expect(hugeBody.days).toBe(STATS_MAX_DAYS);
    expect(hugeBody.sinceDay).not.toBe("0000");
  });
});

describe("コミュニティKPI: 集計の範囲", () => {
  it("他コミュニティ・無所属のイベントは混ざらない", async () => {
    const owner = await makeUser();
    const otherOwner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const other = await makeCommunity(otherOwner.userId);

    const mine = await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
    });
    const p1 = await makeUser();
    const p2 = await makeUser();
    await join({ eventId: mine, userId: p1.userId });
    await join({ eventId: mine, userId: p2.userId });

    const theirs = await makeEvent({
      createdBy: otherOwner.userId,
      communityId: other.id,
    });
    await join({ eventId: theirs, userId: p1.userId });

    const loose = await makeEvent({ createdBy: owner.userId });
    await join({ eventId: loose, userId: p1.userId });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.northStar.heldEvents).toBe(1);
    // 参加体験の数は主催の staff 行を含む定義（2 + 主催1）
    expect(kpi.northStar.participations).toBe(3);
    expect(kpi.northStar.heldParticipants).toBe(2);
    expect(kpi.participants.registrations).toBe(2);
    expect(kpi.organizers.hosts).toBe(1);
  });

  it("全体KPIと数え方が一致し、コミュニティKPIはその部分集合になる", async () => {
    const admin = await makeUser({ admin: true });
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);

    // コミュニティのイベント（参加者2人）
    const inC = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    const p1 = await makeUser();
    const p2 = await makeUser();
    await join({ eventId: inC, userId: p1.userId });
    await join({ eventId: inC, userId: p2.userId });

    // 無所属のイベント（参加者3人）
    const outside = await makeEvent({ createdBy: owner.userId });
    const p3 = await makeUser();
    await join({ eventId: outside, userId: p1.userId });
    await join({ eventId: outside, userId: p2.userId });
    await join({ eventId: outside, userId: p3.userId });

    const all = (await (
      await SELF.fetch(`${BASE}/api/admin/kpi?days=30`, {
        headers: { cookie: admin.cookie },
      })
    ).json()) as KpiPayload;
    const kpi = await getKpi(c.id, admin.cookie, 30);

    // 全体: 2イベント、参加体験 (2+1)+(3+1)=7、参加者 5、参加登録 5
    expect(all.northStar.heldEvents).toBe(2);
    expect(all.northStar.participations).toBe(7);
    expect(all.northStar.heldParticipants).toBe(5);
    expect(all.participants.registrations).toBe(5);

    // コミュニティ: 全体の部分集合
    expect(kpi.northStar.heldEvents).toBe(1);
    expect(kpi.northStar.participations).toBe(3);
    expect(kpi.northStar.heldParticipants).toBe(2);
    expect(kpi.participants.registrations).toBe(2);
    expect(kpi.participants.uniqueParticipants).toBe(2);

    expect(kpi.northStar.participations).toBeLessThanOrEqual(
      all.northStar.participations,
    );
    expect(kpi.northStar.heldEvents).toBeLessThanOrEqual(
      all.northStar.heldEvents,
    );
    expect(kpi.participants.registrations).toBeLessThanOrEqual(
      all.participants.registrations,
    );
  });

  it("審査員・観覧者は参加者として数え、主催の staff 行は数えない", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const ev = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    const p = await makeUser();
    const judge = await makeUser();
    const observer = await makeUser();
    const staff = await makeUser();
    await join({ eventId: ev, userId: p.userId });
    await join({ eventId: ev, userId: judge.userId, role: "judge" });
    await join({ eventId: ev, userId: observer.userId, role: "observer" });
    await join({ eventId: ev, userId: staff.userId, role: "staff" });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.participants.registrations).toBe(3);
    expect(kpi.participants.uniqueParticipants).toBe(3);
    expect(kpi.northStar.participations).toBe(5); // staff 2行を含む全行
    expect(kpi.northStar.heldParticipants).toBe(3);
    expect(kpi.newcomers.participants).toBe(3);
  });
});

describe("コミュニティKPI: 新規流入 vs 常連", () => {
  it("期間より前に参加していた人を常連、それ以外を新規として数える", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const regular = await makeUser();
    const newbies = [
      await makeUser(),
      await makeUser(),
      await makeUser(),
      await makeUser(),
    ];

    // 60日前に開催（期間外）。regular が参加済み
    const past = await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
      endsAt: Date.now() - 60 * DAY,
      createdAt: Date.now() - 61 * DAY,
    });
    await join({
      eventId: past,
      userId: regular.userId,
      createdAt: Date.now() - 61 * DAY,
    });

    // 2日前に開催（期間内）。regular + 新顔4人
    const recent = await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
      endsAt: Date.now() - 2 * DAY,
    });
    await join({ eventId: recent, userId: regular.userId });
    for (const n of newbies) await join({ eventId: recent, userId: n.userId });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    // 参加5人（主催の staff 行は数えない）。うち新規4人
    expect(kpi.newcomers.participants).toBe(5);
    expect(kpi.newcomers.newcomers).toBe(4);
    expect(kpi.newcomers.regulars).toBe(1);
    expect(kpi.newcomers.newcomerRate).toBe(0.8);
    // 期間内の開催は1件だけ
    expect(kpi.northStar.heldEvents).toBe(1);
  });

  it("他コミュニティでの過去の参加歴では常連にならない", async () => {
    const owner = await makeUser();
    const otherOwner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const other = await makeCommunity(otherOwner.userId);
    const people = [
      await makeUser(),
      await makeUser(),
      await makeUser(),
      await makeUser(),
      await makeUser(),
    ];

    // 他コミュニティでの過去イベント（全員参加済み）
    const past = await makeEvent({
      createdBy: otherOwner.userId,
      communityId: other.id,
      endsAt: Date.now() - 60 * DAY,
      createdAt: Date.now() - 61 * DAY,
    });
    for (const p of people) {
      await join({
        eventId: past,
        userId: p.userId,
        createdAt: Date.now() - 61 * DAY,
      });
    }

    const ev = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    for (const p of people) await join({ eventId: ev, userId: p.userId });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.newcomers.participants).toBe(5);
    expect(kpi.newcomers.newcomers).toBe(5);
    expect(kpi.newcomers.newcomerRate).toBe(1);
  });

  it("母数が少ないとき（5人未満）は率を出さない", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const ev = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    for (let i = 0; i < 4; i++) {
      const p = await makeUser();
      await join({ eventId: ev, userId: p.userId });
    }

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.newcomers.participants).toBe(4);
    expect(kpi.newcomers.newcomers).toBe(4);
    // 件数は出すが率は出さない（3人中1人で33%のように極端に振れるため）
    expect(kpi.newcomers.newcomerRate).toBeNull();
  });
});

describe("コミュニティKPI: コア主催者への依存度", () => {
  it("開催した人数と上位1人の開催数シェアを出す", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const coHost = await makeUser();
    await addCommunityMember(c.id, coHost.userId, "admin");

    for (let i = 0; i < 4; i++) {
      await makeEvent({
        createdBy: owner.userId,
        communityId: c.id,
        endsAt: Date.now() - (i + 1) * DAY,
      });
    }
    await makeEvent({
      createdBy: coHost.userId,
      communityId: c.id,
      endsAt: Date.now() - 6 * DAY,
    });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.organizers.heldEvents).toBe(5);
    expect(kpi.organizers.hosts).toBe(2);
    expect(kpi.organizers.heldEventsWithActiveHost).toBe(5);
    expect(kpi.organizers.repeatHosts).toBe(1);
    expect(kpi.organizers.repeatHostRate).toBe(0.5);
    expect(kpi.organizers.avgEventsPerHost).toBe(2.5);
    expect(kpi.organizers.topHostEvents).toBe(4);
    expect(kpi.organizers.topHostShare).toBe(0.8);
    // 全イベントが参加者0人 → すべて不発
    expect(kpi.organizers.dudEvents).toBe(5);
    expect(kpi.organizers.dudRate).toBe(1);
  });

  it("開催数が少ないとき（5件未満）はシェアを出さない", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    await makeEvent({ createdBy: owner.userId, communityId: c.id });
    await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
      endsAt: Date.now() - 2 * DAY,
    });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.organizers.hosts).toBe(1);
    expect(kpi.organizers.topHostEvents).toBe(2);
    expect(kpi.organizers.topHostShare).toBeNull();
  });
});

describe("コミュニティKPI: 休眠会員率", () => {
  it("community_member のうち期間内に参加していない人の割合", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const members = [];
    for (let i = 0; i < 5; i++) {
      const m = await makeUser();
      await addCommunityMember(c.id, m.userId);
      members.push(m);
    }
    // 退会申請中のメンバーは分母から外す
    const gone = await makeUser({ deletedAt: Date.now() });
    await addCommunityMember(c.id, gone.userId);

    const ev = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    await join({ eventId: ev, userId: members[0]!.userId });
    await join({ eventId: ev, userId: members[1]!.userId });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    // 在籍メンバーは owner + 5人 = 6人。参加したのは2人
    // （主催しただけの owner は staff 行なので「参加」に数えない）
    expect(kpi.dormant.members).toBe(6);
    expect(kpi.dormant.activeMembers).toBe(2);
    expect(kpi.dormant.dormantMembers).toBe(4);
    expect(kpi.dormant.dormantRate).toBeCloseTo(4 / 6, 10);
  });

  it("イベント参加だけでフォロー登録していない人は分母に入らない", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const ev = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    for (let i = 0; i < 5; i++) {
      const p = await makeUser();
      await join({ eventId: ev, userId: p.userId });
    }

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.dormant.members).toBe(1); // owner のみ
    expect(kpi.dormant.dormantRate).toBeNull(); // 母数不足
    expect(kpi.newcomers.participants).toBe(5);
  });
});

describe("コミュニティKPI: 参加者の重複度", () => {
  it("他コミュニティと重なっている人数と割合を多い順に出す", async () => {
    const owner = await makeUser();
    const ownerD = await makeUser();
    const ownerE = await makeUser();
    const c = await makeCommunity(owner.userId);
    const d = await makeCommunity(ownerD.userId);
    const e = await makeCommunity(ownerE.userId);

    const people = [];
    for (let i = 0; i < 5; i++) people.push(await makeUser());

    const mine = await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
    });
    for (const p of people) await join({ eventId: mine, userId: p.userId });

    // D: 過去イベントに3人が参加
    const evD = await makeEvent({
      createdBy: ownerD.userId,
      communityId: d.id,
      endsAt: Date.now() - 90 * DAY,
      createdAt: Date.now() - 91 * DAY,
    });
    for (const p of people.slice(0, 3)) {
      await join({ eventId: evD, userId: p.userId });
    }
    // D のスタッフ行は「参加」に数えない
    await join({ eventId: evD, userId: people[3]!.userId, role: "staff" });

    // E: これから開催のイベントに1人が参加（期間は切らないので数える）
    const evE = await makeEvent({
      createdBy: ownerE.userId,
      communityId: e.id,
      endsAt: Date.now() + 10 * DAY,
      startsAt: Date.now() + 9 * DAY,
    });
    await join({ eventId: evE, userId: people[0]!.userId });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.newcomers.participants).toBe(5);
    expect(kpi.overlap.length).toBe(2);
    expect(kpi.overlap[0]!.communityId).toBe(d.id);
    expect(kpi.overlap[0]!.users).toBe(3);
    expect(kpi.overlap[0]!.rate).toBe(0.6);
    expect(kpi.overlap[1]!.communityId).toBe(e.id);
    expect(kpi.overlap[1]!.users).toBe(1);
    expect(kpi.overlap[1]!.rate).toBe(0.2);
    // 自分自身は重複先に出さない
    expect(kpi.overlap.some((o) => o.communityId === c.id)).toBe(false);
  });

  it("母数が少ないときは件数だけ出して率は出さない", async () => {
    const owner = await makeUser();
    const ownerD = await makeUser();
    const c = await makeCommunity(owner.userId);
    const d = await makeCommunity(ownerD.userId);

    const p1 = await makeUser();
    const p2 = await makeUser();
    const mine = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    await join({ eventId: mine, userId: p1.userId });
    await join({ eventId: mine, userId: p2.userId });

    const evD = await makeEvent({ createdBy: ownerD.userId, communityId: d.id });
    await join({ eventId: evD, userId: p1.userId });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.overlap.length).toBe(1);
    expect(kpi.overlap[0]!.users).toBe(1);
    expect(kpi.overlap[0]!.rate).toBeNull();
  });
});

describe("コミュニティKPI: 出席・キャンセル", () => {
  it("出席率と直前キャンセルの内訳を全体KPIと同じ定義で出す", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);

    // 出席チェックあり: 3人登録・2人出席
    const held = await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
      attendanceCheck: true,
    });
    const a = await makeUser();
    const b = await makeUser();
    const noShow = await makeUser();
    await join({ eventId: held, userId: a.userId, attended: true });
    await join({ eventId: held, userId: b.userId, attended: true });
    await join({ eventId: held, userId: noShow.userId, attended: false });

    // これから開催: 直前キャンセル1・事前キャンセル1
    const startsAt = Date.now() + 5 * DAY;
    const future = await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
      startsAt,
      endsAt: startsAt + 3600000,
    });
    const late = await makeUser();
    const early = await makeUser();
    await join({
      eventId: future,
      userId: late.userId,
      status: "canceled",
      canceledAt: startsAt - DAY / 2,
    });
    await join({
      eventId: future,
      userId: early.userId,
      status: "canceled",
      canceledAt: startsAt - 3 * DAY,
    });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.participants.attendanceExpected).toBe(3);
    expect(kpi.participants.attended).toBe(2);
    expect(kpi.participants.attendanceRate).toBeCloseTo(2 / 3, 10);
    expect(kpi.participants.noShowRate).toBeCloseTo(1 / 3, 10);
    expect(kpi.participants.registrations).toBe(5);
    expect(kpi.participants.canceled).toBe(2);
    expect(kpi.participants.canceledLate).toBe(1);
    expect(kpi.participants.canceledEarly).toBe(1);
    expect(kpi.participants.cancelRate).toBe(0.4);
    expect(kpi.participants.lateCancelRate).toBe(0.5);
    // 出席チェック実施イベントは出席者数を数える（2 + 主催1）
    expect(kpi.northStar.participations).toBe(3);
  });

  it("参加回数の分布を出す", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const repeater = await makeUser();
    const once = await makeUser();
    const e1 = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    const e2 = await makeEvent({
      createdBy: owner.userId,
      communityId: c.id,
      endsAt: Date.now() - 2 * DAY,
    });
    await join({ eventId: e1, userId: repeater.userId });
    await join({ eventId: e2, userId: repeater.userId });
    await join({ eventId: e1, userId: once.userId });

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.participants.uniqueParticipants).toBe(2);
    expect(kpi.participants.repeatParticipants).toBe(1);
    expect(kpi.participants.repeatRate).toBe(0.5);
    const dist = Object.fromEntries(
      kpi.participants.countDistribution.map((b) => [b.label, b.users]),
    );
    expect(dist["1回"]).toBe(1);
    expect(dist["2回"]).toBe(1);
  });

  it("イベント詳細の閲覧UUと転換率はこのコミュニティのイベントだけを見る", async () => {
    const owner = await makeUser();
    const c = await makeCommunity(owner.userId);
    const mine = await makeEvent({ createdBy: owner.userId, communityId: c.id });
    const loose = await makeEvent({ createdBy: owner.userId });
    const p1 = await makeUser();
    const p2 = await makeUser();
    await join({ eventId: mine, userId: p1.userId });
    await join({ eventId: mine, userId: p2.userId });

    const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    for (const [eventId, visitors, views] of [
      [mine, ["v1", "v2", "v3", "v4"], 9],
      [loose, ["v5", "v6"], 5],
    ] as const) {
      for (const v of visitors) {
        await env.DB.prepare(
          "INSERT INTO event_view_unique (event_id, day, visitor_id) VALUES (?, ?, ?)",
        )
          .bind(eventId, day, v)
          .run();
      }
      await env.DB.prepare(
        "INSERT INTO event_view_stat (event_id, day, source, country, views) VALUES (?, ?, 'direct', 'JP', ?)",
      )
        .bind(eventId, day, views)
        .run();
    }

    const kpi = await getKpi(c.id, owner.cookie, 30);
    expect(kpi.participants.uniqueViewers).toBe(4);
    expect(kpi.participants.totalViews).toBe(9);
    expect(kpi.participants.viewToJoinRate).toBe(0.5);
  });
});
