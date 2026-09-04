import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { COMMUNITY_KPI_MIN_SAMPLE } from "@eventer/shared";
import {
  DAY,
  addUniqueView,
  dayAgo,
  getCommunityKpi,
  getKpi,
  join,
  makeCommunity,
  makeEvent,
  makeUser,
} from "./lib/kpiFixtures.js";

/**
 * 全体KPI (kpi.ts) とコミュニティKPI (communityKpi.ts) が**同じ定義で数えている**
 * ことを見張る (#466)。
 *
 * 数え方は kpiMetrics.ts の断片に1つだけ置いてあるが、断片が1つでも
 * 「片方の呼び出し側だけ引数を間違える」「片方だけ別の式に書き戻す」は起こる。
 * 各テストは**イベントをすべて1つのコミュニティに置く**ので、同じ期間なら
 * 全体KPIとコミュニティKPIの数字は一致していなければならない。ずれたら
 * どちらかの定義が動いたということ。
 *
 * 率のゲート（母数が小さいとき率を出さない）だけは意図的に違う。最後の
 * describe がその差分——ゲートを通す3つと通さない6つ——を固定している。
 */

const OK = COMMUNITY_KPI_MIN_SAMPLE; // 5

/** 出席チェックを有効にする（fixtures の makeEvent は既定で無効） */
async function enableCheckin(eventId: string): Promise<void> {
  await env.DB.prepare("UPDATE event SET attendance_check = 1 WHERE id = ?")
    .bind(eventId)
    .run();
}

/** 出席を記録する */
async function markAttended(eventId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE event_member SET attended = 1 WHERE event_id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .run();
}

/** 退会申請中にする (#250) */
async function requestDeletion(userId: string): Promise<void> {
  await env.DB.prepare("UPDATE user SET deleted_at = ? WHERE id = ?")
    .bind(Date.now(), userId)
    .run();
}

describe("開催の人数（pcount / ppl / 出席未記録）", () => {
  it("主催・スタッフを含む「集まった人数」と、含まない「参加者数」を両方の画面で同じに数える", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const cid = await makeCommunity(host.userId);
    const ev = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    // 参加者3人 + 審査員1人 + 退会申請中1人（数えない）
    for (let i = 0; i < 3; i++) {
      const u = await makeUser();
      await join({ eventId: ev, userId: u.userId });
    }
    const judge = await makeUser();
    await join({ eventId: ev, userId: judge.userId, role: "judge" });
    const gone = await makeUser();
    await join({ eventId: ev, userId: gone.userId });
    await requestDeletion(gone.userId);

    const k = await getKpi(admin.cookie, 30);
    const c = await getCommunityKpi(cid, admin.cookie, 30);
    // pcount: staff(主催) + 参加者3 + 審査員1 = 5（退会申請中は除く）
    expect(k.northStar.participations).toBe(5);
    // ppl: staff を除く 4
    expect(k.northStar.heldParticipants).toBe(4);
    expect(c.northStar.participations).toBe(k.northStar.participations);
    expect(c.northStar.heldParticipants).toBe(k.northStar.heldParticipants);
  });

  it("出席チェック有効で記録0件のイベントは両方の画面で「出席未記録」に振り分ける", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const cid = await makeCommunity(host.userId);
    const ev = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    await enableCheckin(ev);
    for (let i = 0; i < 3; i++) {
      const u = await makeUser();
      await join({ eventId: ev, userId: u.userId });
    }

    const k = await getKpi(admin.cookie, 30);
    const c = await getCommunityKpi(cid, admin.cookie, 30);
    expect(k.organizers.attendanceUnrecordedEvents).toBe(1);
    expect(k.organizers.dudEvents).toBe(0);
    expect(k.organizers.dudBaseEvents).toBe(0);
    expect(c.organizers.attendanceUnrecordedEvents).toBe(1);
    expect(c.organizers.dudEvents).toBe(0);
    expect(c.organizers.dudBaseEvents).toBe(0);
  });

  it("不発のしきい値（参加者3人以下）が両方の画面で同じ", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const cid = await makeCommunity(host.userId);
    // 参加者3人 = 不発 / 4人 = 不発でない
    for (const n of [3, 4]) {
      const ev = await makeEvent({
        createdBy: host.userId,
        endsAt: Date.now() - 2 * DAY,
        communityId: cid,
      });
      for (let i = 0; i < n; i++) {
        const u = await makeUser();
        await join({ eventId: ev, userId: u.userId });
      }
    }

    const k = await getKpi(admin.cookie, 30);
    const c = await getCommunityKpi(cid, admin.cookie, 30);
    expect(k.organizers.heldEvents).toBe(2);
    expect(k.organizers.dudEvents).toBe(1);
    expect(c.organizers.heldEvents).toBe(2);
    expect(c.organizers.dudEvents).toBe(1);
  });
});

describe("参加登録・キャンセル・出席", () => {
  it("登録数・取消・直前取消・出席の4指標が両方の画面で一致する", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const cid = await makeCommunity(host.userId);
    const startsAt = Date.now() - 2 * DAY;
    const ev = await makeEvent({
      createdBy: host.userId,
      endsAt: startsAt + 3600000,
      communityId: cid,
    });
    await enableCheckin(ev);
    // 確定2人（うち1人だけ出席記録あり）
    const a = await makeUser();
    const b = await makeUser();
    await join({ eventId: ev, userId: a.userId, createdAt: Date.now() - DAY });
    await join({ eventId: ev, userId: b.userId, createdAt: Date.now() - DAY });
    await markAttended(ev, a.userId);
    // 事前キャンセル1人・直前キャンセル1人
    const early = await makeUser();
    await join({
      eventId: ev,
      userId: early.userId,
      status: "canceled",
      createdAt: Date.now() - DAY,
      canceledAt: startsAt - 3 * 86400000,
    });
    const late = await makeUser();
    await join({
      eventId: ev,
      userId: late.userId,
      status: "canceled",
      createdAt: Date.now() - DAY,
      canceledAt: startsAt - 1000,
    });

    const k = await getKpi(admin.cookie, 30);
    const c = await getCommunityKpi(cid, admin.cookie, 30);
    // 主催の staff 行は登録に数えない
    expect(k.participants.registrations).toBe(4);
    expect(k.participants.canceled).toBe(2);
    expect(k.participants.canceledLate).toBe(1);
    expect(k.participants.canceledEarly).toBe(1);
    expect(k.participants.attendanceExpected).toBe(2);
    expect(k.participants.attended).toBe(1);
    for (const key of [
      "registrations",
      "confirmedRegistrations",
      "canceled",
      "canceledLate",
      "canceledEarly",
      "attendanceExpected",
      "attended",
    ] as const) {
      expect([key, c.participants[key]]).toEqual([key, k.participants[key]]);
    }
  });
});

describe("リピートと主催の実人数", () => {
  it("参加した実人数・2回以上の人数・主催者数・開催件数が両方の画面で一致する", async () => {
    const admin = await makeUser({ admin: true });
    const host1 = await makeUser();
    const host2 = await makeUser();
    const cid = await makeCommunity(host1.userId);
    const repeater = await makeUser();
    const once = await makeUser();
    // host1 が「ちょうど2件」・host2 が1件（再開催したのは host1 だけ）。
    // repeater は「ちょうど2件」に参加する。3件以上にすると
    // 「2回以上」のしきい値を動かしても数字が変わらず、テストが効かない
    for (const h of [host1, host1]) {
      const ev = await makeEvent({
        createdBy: h.userId,
        endsAt: Date.now() - 2 * DAY,
        communityId: cid,
      });
      await join({ eventId: ev, userId: repeater.userId });
    }
    const solo = await makeEvent({
      createdBy: host2.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    await join({ eventId: solo, userId: once.userId });

    const k = await getKpi(admin.cookie, 30);
    const c = await getCommunityKpi(cid, admin.cookie, 30);
    expect(k.participants.uniqueParticipants).toBe(2);
    expect(k.participants.repeatParticipants).toBe(1);
    expect(k.organizers.hosts).toBe(2);
    expect(k.organizers.repeatHosts).toBe(1);
    expect(k.organizers.heldEventsWithActiveHost).toBe(3);
    expect(c.participants.uniqueParticipants).toBe(
      k.participants.uniqueParticipants,
    );
    expect(c.participants.repeatParticipants).toBe(
      k.participants.repeatParticipants,
    );
    expect(c.organizers.hosts).toBe(k.organizers.hosts);
    expect(c.organizers.repeatHosts).toBe(k.organizers.repeatHosts);
    expect(c.organizers.heldEventsWithActiveHost).toBe(
      k.organizers.heldEventsWithActiveHost,
    );
  });

  it("参加回数の区切り（4回は「4〜5回」）が両方の画面で同じ", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const cid = await makeCommunity(host.userId);
    const four = await makeUser();
    const three = await makeUser();
    for (let i = 0; i < 4; i++) {
      const ev = await makeEvent({
        createdBy: host.userId,
        endsAt: Date.now() - 2 * DAY,
        communityId: cid,
      });
      await join({ eventId: ev, userId: four.userId });
      if (i < 3) await join({ eventId: ev, userId: three.userId });
    }

    const k = await getKpi(admin.cookie, 30);
    const c = await getCommunityKpi(cid, admin.cookie, 30);
    const bucket = (
      p: { participants: { countDistribution: { label: string; users: number }[] } },
      label: string,
    ) => p.participants.countDistribution.find((b) => b.label === label)?.users;
    expect(bucket(k, "3回")).toBe(1);
    expect(bucket(k, "4〜5回")).toBe(1);
    expect(bucket(k, "2回")).toBe(0);
    expect(bucket(c, "3回")).toBe(bucket(k, "3回"));
    expect(bucket(c, "4〜5回")).toBe(bucket(k, "4〜5回"));
    expect(c.participants.countDistribution.map((b) => b.label)).toEqual(
      k.participants.countDistribution.map((b) => b.label),
    );
  });
});

describe("日次推移の枝（開催数・参加体験数）", () => {
  it("開催日の日に立てる件数と人数が両方の画面で一致する", async () => {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const cid = await makeCommunity(host.userId);
    const ev = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    for (let i = 0; i < 2; i++) {
      const u = await makeUser();
      await join({ eventId: ev, userId: u.userId });
    }
    // 出席チェック有効・未出席の人は参加体験に数えない（役割が participant のため）
    const ev2 = await makeEvent({
      createdBy: host.userId,
      endsAt: Date.now() - 2 * DAY,
      communityId: cid,
    });
    await enableCheckin(ev2);
    const came = await makeUser();
    const noshow = await makeUser();
    await join({ eventId: ev2, userId: came.userId });
    await join({ eventId: ev2, userId: noshow.userId });
    await markAttended(ev2, came.userId);

    const day = dayAgo(2);
    const k = await getKpi(admin.cookie, 30);
    const c = await getCommunityKpi(cid, admin.cookie, 30);
    const kd = k.retention.daily.find((d) => d.day === day);
    const cd = c.daily.find((d) => d.day === day);
    // 主催の staff 行は両イベントとも数える（role <> 'participant'）
    expect(kd?.heldEvents).toBe(2);
    expect(kd?.participations).toBe(2 + 1 + 1 + 1);
    expect(cd?.heldEvents).toBe(kd?.heldEvents);
    expect(cd?.participations).toBe(kd?.participations);
    // タイルの北極星と同じ数え方（日次だけ別定義になっていない）
    expect(k.northStar.participations).toBe(kd?.participations);
    expect(c.northStar.participations).toBe(cd?.participations);
  });
});

describe("率のゲートの掛かり方", () => {
  /** 母数がゲート (5) に満たないデータを1つ作る */
  async function smallSample() {
    const admin = await makeUser({ admin: true });
    const host = await makeUser();
    const cid = await makeCommunity(host.userId);
    const repeater = await makeUser();
    const startsAt = Date.now() - 2 * DAY;
    for (let i = 0; i < 2; i++) {
      const ev = await makeEvent({
        createdBy: host.userId,
        endsAt: startsAt + 3600000,
        communityId: cid,
      });
      await enableCheckin(ev);
      await join({
        eventId: ev,
        userId: repeater.userId,
        createdAt: Date.now() - DAY,
      });
      await markAttended(ev, repeater.userId);
      await addUniqueView(ev, dayAgo(3), `v${i}`);
      const canceler = await makeUser();
      await join({
        eventId: ev,
        userId: canceler.userId,
        status: "canceled",
        createdAt: Date.now() - DAY,
        canceledAt: startsAt - 1000,
      });
    }
    return {
      k: await getKpi(admin.cookie, 30),
      c: await getCommunityKpi(cid, admin.cookie, 30),
    };
  }

  it("母数が足りないとき、ゲートを通す3つはコミュニティKPIだけ null になる", async () => {
    const { k, c } = await smallSample();
    // 母数はどれも 5 未満
    expect(k.participants.uniqueParticipants).toBeLessThan(OK);
    expect(k.organizers.dudBaseEvents).toBeLessThan(OK);
    expect(k.organizers.hosts).toBeLessThan(OK);

    expect(k.participants.repeatRate).not.toBeNull();
    expect(k.organizers.dudRate).not.toBeNull();
    expect(k.organizers.repeatHostRate).not.toBeNull();

    expect(c.participants.repeatRate).toBeNull();
    expect(c.organizers.dudRate).toBeNull();
    expect(c.organizers.repeatHostRate).toBeNull();
  });

  it("ゲートを通さない率と平均は、母数が足りなくても両方の画面で同じ値が出る", async () => {
    const { k, c } = await smallSample();
    expect(k.northStar.avgParticipantsPerEvent).not.toBeNull();
    expect(k.participants.viewToJoinRate).not.toBeNull();
    expect(k.participants.attendanceRate).not.toBeNull();
    expect(k.participants.cancelRate).not.toBeNull();
    expect(k.participants.lateCancelRate).not.toBeNull();
    expect(k.organizers.avgEventsPerHost).not.toBeNull();

    expect(c.northStar.avgParticipantsPerEvent).toBe(
      k.northStar.avgParticipantsPerEvent,
    );
    expect(c.participants.viewToJoinRate).toBe(k.participants.viewToJoinRate);
    expect(c.participants.attendanceRate).toBe(k.participants.attendanceRate);
    expect(c.participants.noShowRate).toBe(k.participants.noShowRate);
    expect(c.participants.cancelRate).toBe(k.participants.cancelRate);
    expect(c.participants.lateCancelRate).toBe(k.participants.lateCancelRate);
    expect(c.organizers.avgEventsPerHost).toBe(k.organizers.avgEventsPerHost);
  });
});
