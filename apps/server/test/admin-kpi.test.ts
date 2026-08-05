import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { KpiPayload } from "@eventer/shared";

const BASE = "https://example.com";
const DAY = 86400000;

/** ユーザーを1人作る（セッション付き）。
 * admin=true なら discord_id を ADMIN_DISCORD_IDS(=dev-user) に一致させる */
async function makeUser(opts: {
  admin?: boolean;
  createdAt?: number;
  deletedAt?: number | null;
} = {}): Promise<{ userId: string; cookie: string }> {
  const uid = crypto.randomUUID();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO user (id, discord_id, username, global_name, avatar_url, created_at, deleted_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
  )
    .bind(
      uid,
      opts.admin ? "dev-user" : `t:${uid}`,
      `u_${uid.slice(0, 8)}`,
      opts.createdAt ?? Date.now(),
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

async function makeEvent(opts: {
  createdBy: string;
  status?: string;
  startsAt?: number;
  endsAt?: number;
  attendanceCheck?: boolean;
  scheduling?: boolean;
  createdAt?: number;
  venueWanted?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  const endsAt = opts.endsAt ?? Date.now() - DAY;
  await env.DB.prepare(
    `INSERT INTO event (id, title, description, starts_at, ends_at, venue_type,
       status, created_by, created_at, attendance_check, scheduling, venue_wanted)
     VALUES (?, ?, '', ?, ?, 'online', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `e_${id.slice(0, 8)}`,
      opts.startsAt ?? endsAt - 3600000,
      endsAt,
      opts.status ?? "published",
      opts.createdBy,
      opts.createdAt ?? Date.now(),
      opts.attendanceCheck ? 1 : 0,
      opts.scheduling ? 1 : 0,
      opts.venueWanted ? 1 : 0,
    )
    .run();
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
  canceledScheduling?: boolean;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_member (id, event_id, user_id, role, created_at, status,
       attended, canceled_at, canceled_scheduling)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      opts.canceledScheduling ? 1 : 0,
    )
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

describe("GET /api/admin/kpi 認可", () => {
  it("未ログインは 401", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/kpi`);
    expect(res.status).toBe(401);
  });

  it("運営管理者でないユーザーは 403", async () => {
    const u = await makeUser();
    const res = await SELF.fetch(`${BASE}/api/admin/kpi`, {
      headers: { cookie: u.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("運営管理者は 200", async () => {
    const admin = await makeUser({ admin: true });
    const res = await SELF.fetch(`${BASE}/api/admin/kpi`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
  });
});

describe("KPI: データが無いとき", () => {
  it("ゼロ除算せず、率は null・件数は 0 で返る", async () => {
    const admin = await makeUser({ admin: true });
    const kpi = await getKpi(admin.cookie, 30);

    expect(kpi.northStar.participations).toBe(0);
    expect(kpi.northStar.heldEvents).toBe(0);
    expect(kpi.northStar.avgParticipantsPerEvent).toBeNull();
    expect(kpi.participants.attendanceRate).toBeNull();
    expect(kpi.participants.noShowRate).toBeNull();
    expect(kpi.participants.cancelRate).toBeNull();
    expect(kpi.participants.lateCancelRate).toBeNull();
    expect(kpi.participants.repeatRate).toBeNull();
    expect(kpi.participants.viewToJoinRate).toBeNull();
    expect(kpi.organizers.dudRate).toBeNull();
    expect(kpi.organizers.repeatHostRate).toBeNull();
    expect(kpi.organizers.avgEventsPerHost).toBeNull();
    expect(kpi.organizers.schedulingConfirmRate).toBeNull();
    expect(kpi.health.chatUsedRate).toBeNull();
    expect(kpi.matching.venueOfferAcceptRate).toBeNull();
    expect(kpi.matching.eggConversionRate).toBeNull();

    // NaN / Infinity が JSON に混ざっていないこと（JSON では null になる）
    const flat = JSON.stringify(kpi);
    expect(flat).not.toContain("NaN");
    expect(flat).not.toContain("Infinity");
  });
});

describe("KPI: 北極星と出席率", () => {
  it("出席チェック実施イベントは出席者数、未実施は確定登録者数を数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const p1 = await makeUser();
    const p2 = await makeUser();
    const p3 = await makeUser();

    // A: 出席チェックあり。3人登録、2人出席
    const evA = await makeEvent({
      createdBy: host.userId,
      attendanceCheck: true,
      endsAt: Date.now() - DAY,
    });
    await join({ eventId: evA, userId: p1.userId, attended: true });
    await join({ eventId: evA, userId: p2.userId, attended: true });
    await join({ eventId: evA, userId: p3.userId, attended: false });

    // B: 出席チェックなし。2人登録
    const evB = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 2 * DAY,
    });
    await join({ eventId: evB, userId: p1.userId });
    await join({ eventId: evB, userId: p2.userId });

    // C: これから開催（開催済みに含めない）
    const evC = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() + DAY,
      startsAt: Date.now() + DAY - 3600000,
    });
    await join({ eventId: evC, userId: p1.userId });

    const kpi = await getKpi(admin.cookie, 30);

    // A: 出席2人 + B: 登録2人 = 4
    expect(kpi.northStar.heldEvents).toBe(2);
    expect(kpi.northStar.participations).toBe(4);
    expect(kpi.northStar.avgParticipantsPerEvent).toBe(2);

    // 出席率の分母は「出席チェック実施の開催済みイベント」の確定参加者 = 3
    expect(kpi.participants.attendanceExpected).toBe(3);
    expect(kpi.participants.attended).toBe(2);
    expect(kpi.participants.attendanceRate).toBeCloseTo(2 / 3, 10);
    expect(kpi.participants.noShowRate).toBeCloseTo(1 / 3, 10);
  });

  it("参加者3人以下の開催は「不発」として数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const dud = await makeEvent({ createdBy: host.userId });
    const p1 = await makeUser();
    await join({ eventId: dud, userId: p1.userId });

    const kpi = await getKpi(admin.cookie, 30);
    expect(kpi.organizers.heldEvents).toBe(1);
    expect(kpi.organizers.dudEvents).toBe(1);
    expect(kpi.organizers.dudRate).toBe(1);
  });
});

describe("KPI: キャンセル率", () => {
  it("事前 / 直前24時間の内訳を出す", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const startsAt = Date.now() + 5 * DAY;
    const ev = await makeEvent({
      createdBy: host.userId,
      startsAt,
      endsAt: startsAt + 3600000,
    });

    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const d = await makeUser();
    // 確定2人
    await join({ eventId: ev, userId: a.userId });
    await join({ eventId: ev, userId: b.userId });
    // 事前キャンセル（開始の3日前）
    await join({
      eventId: ev,
      userId: c.userId,
      status: "canceled",
      canceledAt: startsAt - 3 * DAY,
    });
    // 直前キャンセル（開始の12時間前）
    await join({
      eventId: ev,
      userId: d.userId,
      status: "canceled",
      canceledAt: startsAt - DAY / 2,
    });

    const kpi = await getKpi(admin.cookie, 30);
    expect(kpi.participants.registrations).toBe(4);
    expect(kpi.participants.confirmedRegistrations).toBe(2);
    expect(kpi.participants.canceled).toBe(2);
    expect(kpi.participants.canceledLate).toBe(1);
    expect(kpi.participants.canceledEarly).toBe(1);
    expect(kpi.participants.cancelRate).toBe(0.5);
    expect(kpi.participants.lateCancelRate).toBe(0.5);
  });
});

describe("KPI: リピート参加率と再開催率", () => {
  it("2回以上参加した人の割合と参加回数の分布", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const repeater = await makeUser();
    const once = await makeUser();

    const e1 = await makeEvent({ createdBy: host.userId, endsAt: Date.now() - DAY });
    const e2 = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 2 * DAY,
    });
    await join({ eventId: e1, userId: repeater.userId });
    await join({ eventId: e2, userId: repeater.userId });
    await join({ eventId: e1, userId: once.userId });

    const kpi = await getKpi(admin.cookie, 30);
    expect(kpi.participants.uniqueParticipants).toBe(2);
    expect(kpi.participants.repeatParticipants).toBe(1);
    expect(kpi.participants.repeatRate).toBe(0.5);
    const dist = Object.fromEntries(
      kpi.participants.countDistribution.map((b) => [b.label, b.users]),
    );
    expect(dist["1回"]).toBe(1);
    expect(dist["2回"]).toBe(1);

    // 主催者は 1人・2回開催
    expect(kpi.organizers.hosts).toBe(1);
    expect(kpi.organizers.repeatHosts).toBe(1);
    expect(kpi.organizers.repeatHostRate).toBe(1);
    expect(kpi.organizers.avgEventsPerHost).toBe(2);
  });
});

describe("KPI: アクティベーション率", () => {
  it("新規登録者のうち参加・主催した割合", async () => {
    const admin = await makeUser({ admin: true });
    // admin 自身も新規登録者としてカウントされるので、それを含めて期待値を作る
    const joiner = await makeUser();
    const hoster = await makeUser();
    const idle = await makeUser();

    const ev = await makeEvent({ createdBy: hoster.userId, status: "published" });
    await join({ eventId: ev, userId: joiner.userId });

    const kpi = await getKpi(admin.cookie, 30);
    expect(kpi.retention.signups).toBe(4); // admin + joiner + hoster + idle
    expect(kpi.retention.activatedParticipant).toBe(1);
    expect(kpi.retention.activatedHost).toBe(1);
    expect(kpi.retention.activationParticipantRate).toBe(0.25);
    expect(kpi.retention.activationHostRate).toBe(0.25);
    expect(kpi.retention.activeUsers).toBe(4);
    // 日次推移: 新規4人・参加1件が今日の1行にまとまる
    expect(kpi.retention.daily.length).toBe(1);
    expect(kpi.retention.daily[0]!.signups).toBe(4);
    expect(kpi.retention.daily[0]!.joins).toBe(1);
  });

  it("退会申請中ユーザーは成長・定着の分母から外し、退会数として数える", async () => {
    const admin = await makeUser({ admin: true });
    await makeUser({ deletedAt: Date.now() });

    const kpi = await getKpi(admin.cookie, 30);
    expect(kpi.retention.signups).toBe(1); // admin のみ
    expect(kpi.retention.activeUsers).toBe(1);
    expect(kpi.health.pendingDeletion).toBe(1);
  });

  it("監査ログから退会申請数・完全削除数・復帰数を数える", async () => {
    const admin = await makeUser({ admin: true });
    for (const action of [
      "account_delete_requested",
      "account_delete_requested",
      "account_delete_completed",
      "account_restore",
    ]) {
      await env.DB.prepare(
        "INSERT INTO audit_log (id, action, actor_user_id, actor_handle, target_user_id, target_handle, detail, created_at) VALUES (?, ?, NULL, '', NULL, '', '', ?)",
      )
        .bind(crypto.randomUUID(), action, Date.now())
        .run();
    }

    const kpi = await getKpi(admin.cookie, 30);
    expect(kpi.health.deleteRequested).toBe(2);
    expect(kpi.health.deleteCompleted).toBe(1);
    expect(kpi.health.restored).toBe(1);
  });
});

describe("KPI: 期間の絞り込み", () => {
  it("期間外に終了したイベントは北極星に含めない", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const p = await makeUser();

    const old = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 60 * DAY,
      createdAt: Date.now() - 61 * DAY,
    });
    await join({ eventId: old, userId: p.userId, createdAt: Date.now() - 61 * DAY });

    const week = await getKpi(admin.cookie, 7);
    expect(week.northStar.heldEvents).toBe(0);
    expect(week.northStar.participations).toBe(0);

    const all = await getKpi(admin.cookie);
    expect(all.days).toBeNull();
    expect(all.sinceDay).toBe("0000");
    expect(all.northStar.heldEvents).toBe(1);
    expect(all.northStar.participations).toBe(1);
  });
});

describe("KPI: マッチングと機能利用率", () => {
  it("たまごの賛同・イベント化と会場募集の充足を数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const fan = await makeUser();

    // たまご2件（うち1件はイベント化済み・賛同1件）
    const eggA = crypto.randomUUID();
    const eggB = crypto.randomUUID();
    for (const id of [eggA, eggB]) {
      await env.DB.prepare(
        "INSERT INTO event_request (id, title, description, status, created_by, created_at) VALUES (?, ?, '', 'open', ?, ?)",
      )
        .bind(id, `egg_${id.slice(0, 6)}`, host.userId, Date.now())
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO event_request_reaction (request_id, user_id, kind, created_at) VALUES (?, ?, 'attend', ?)",
    )
      .bind(eggA, fan.userId, Date.now())
      .run();
    const born = await makeEvent({ createdBy: host.userId, venueWanted: true });
    await env.DB.prepare(
      "INSERT INTO event_request_event (request_id, event_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(eggA, born, Date.now())
      .run();

    // 会場募集中イベント2件のうち1件に承諾済みオファー
    const wanted2 = await makeEvent({ createdBy: host.userId, venueWanted: true });
    const venueId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO venue (id, owner_id, name, created_at, updated_at) VALUES (?, ?, 'v', ?, ?)",
    )
      .bind(venueId, host.userId, Date.now(), Date.now())
      .run();
    await env.DB.prepare(
      "INSERT INTO venue_offer (id, venue_id, event_id, direction, status, created_by, created_at) VALUES (?, ?, ?, 'venue_to_event', 'accepted', ?, ?)",
    )
      .bind(crypto.randomUUID(), venueId, born, host.userId, Date.now())
      .run();

    const kpi = await getKpi(admin.cookie, 30);
    expect(kpi.matching.eggs).toBe(2);
    expect(kpi.matching.eggAttendReactions).toBe(1);
    expect(kpi.matching.eggsConverted).toBe(1);
    expect(kpi.matching.eggConversionRate).toBe(0.5);
    expect(kpi.matching.venueOffers).toBe(1);
    expect(kpi.matching.venueOffersAccepted).toBe(1);
    expect(kpi.matching.venueOfferAcceptRate).toBe(1);
    expect(kpi.matching.venueWantedEvents).toBe(2);
    expect(kpi.matching.venueWantedFilled).toBe(1);
    expect(kpi.matching.venueWantedFillRate).toBe(0.5);
    expect(wanted2).toBeTruthy();

    // 機能利用率の分母は期間内に作成された公開イベント
    expect(kpi.health.featureEvents).toBe(2);
    expect(kpi.health.checkinUsedEvents).toBe(0);
    expect(kpi.health.checkinUsedRate).toBe(0);
  });
});
