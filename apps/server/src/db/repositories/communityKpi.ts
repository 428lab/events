import {
  COMMUNITY_KPI_MIN_SAMPLE,
  type CommunityKpiDailyPoint,
  type CommunityKpiOverlapItem,
  type CommunityKpiPayload,
  type KpiPreviousValues,
  addDays,
} from "@eventer/shared";
import { many, one } from "../client.js";
import {
  type AggPick,
  COUNT_BUCKET_COLUMNS,
  type CountBucketRow,
  DAILY_HELD_EVENTS,
  DAILY_PARTICIPATIONS,
  type Dual,
  HELD,
  HELD_EVENT_COUNTS,
  HELD_METRIC_COLUMNS,
  HELD_PERIOD,
  type HeldEventAgg,
  type HostAgg as HostCountAgg,
  HOST_COUNT_COLUMNS,
  JOINED,
  MEMBER_USER_ACTIVE,
  N,
  REGISTRATION_COLUMNS,
  REGISTRATION_SOURCE,
  REPEAT_PEOPLE_COLUMNS,
  type RegistrationAgg,
  type RepeatAgg as RepeatCountAgg,
  USER_ACTIVE,
  type ViewAgg,
  countDistribution,
  jd,
  picker,
  rate,
  sharedMetrics,
} from "./kpiMetrics.js";
import { clampSeriesStart, jstDay } from "./kpiSeries.js";

/** 母数が小さいときは率を出さない。3人中1人が新規で 33% のように極端に振れて、
 * 主催者の評価のように誤読されるのを防ぐ（画面は「母数が少ないため非表示」）。
 *
 * コミュニティKPIの画面に出る「率」はすべてこれを通す。件数と平均は素のまま出す
 * （画面の注記も「率だけ隠す」と書いてあるので、率を1つでも素通しにすると
 * 同じセクション内で基準が食い違って見える）。
 * 分母は「人数」とは限らない（不発率・主催シェアはイベント件数）。同じ定数を
 * 人数にも件数にも使っているのは、どちらも1つ増減しただけで率が大きく動くため。
 *
 * 前期間 (#266) の率も同じゲートを通す。前期間だけ素通しにすると、
 * 「今期間は—なのに前期間比だけ出ている」という辻褄の合わない表示になる。 */
function rateMin(numerator: number, denominator: number): number | null {
  if (denominator < COMMUNITY_KPI_MIN_SAMPLE) return null;
  return rate(numerator, denominator);
}

/** 「期間内に開催されたこのコミュニティのイベントに参加した」行の条件。
 * 全体KPI のリピート集計 (kpiRepo.overview の repeatAgg) と同じ定義。
 * バインド順: (HELD の) now, sinceDay → communityId */
const JOINED_HELD_IN_COMMUNITY = (m: string, e: string) =>
  `${m}.status = 'confirmed' AND ${JOINED(m)}
     AND (${e}.attendance_check = 0 OR ${m}.attended = 1)
     AND ${HELD(e)} AND ${e}.community_id = ?`;

/** 上の期間フラグ版（今期間=1 / 前期間=2）。
 * バインド順: (HELD_PERIOD の) now, sinceDay, prevSinceDay, sinceDay → communityId */
const JOINED_HELD_IN_COMMUNITY_PERIOD = (m: string, e: string) =>
  `${m}.status = 'confirmed' AND ${JOINED(m)}
     AND (${e}.attendance_check = 0 OR ${m}.attended = 1)
     AND ${e}.community_id = ?`;

/** コミュニティKPIの開催指標は全体KPIの5指標そのまま（追加の列は無い） */
type EventAgg = HeldEventAgg;

/** 全体KPIのリピート集計に「初参加」を足したもの */
interface RepeatAgg extends RepeatCountAgg {
  newcomers: number;
}

/** 参加回数の分布は今期間ぶんだけ */
interface RepeatRow extends Dual<RepeatAgg>, CountBucketRow {}

/** 全体KPIの主催集計に「上位1人の開催数」（バス係数）を足したもの */
interface HostAgg extends HostCountAgg {
  top_host_events: number;
}

interface DormantAgg {
  active_members: number;
}

/** フォロー人数は「いまフォローしている人」のスナップショット。
 * 過去のある時点のフォロー数は復元できない（community_member は現在の在籍だけ）ので、
 * 休眠会員率は前期間も同じ分母で出す */
interface DormantSnapshot {
  members: number;
}

interface OverlapRow {
  id: string;
  slug: string;
  name: string;
  users: number;
}

interface DailyRow {
  day: string;
  held_events: number;
  participations: number;
}

export const communityKpiRepo = {
  /** コミュニティ運営者向けのKPI (#262)。数え方は全体KPI (kpi.ts) と同じ断片
   * (kpiMetrics.ts) を使っており、同じ期間なら community KPI の各数字は
   * 全体KPIの部分集合になる。
   * Workers のサブリクエスト上限を意識して 8 本にまとめている
   * （前期間 (#266) は本数を増やさず各クエリの CASE で同時に数える）。 */
  async overview(
    community: { id: string; slug: string; name: string },
    sinceDay: string,
    prevSinceDay: string,
    days: number | null,
  ): Promise<CommunityKpiPayload> {
    const now = Date.now();
    const today = jstDay(now);
    const cid = community.id;

    // --- (1) イベント: 北極星・不発率 ---
    // ?の並びは SQL の字面の順。HELD_PERIOD は SELECT 句の中に出るので
    // WHERE の community_id より先にバインドする
    const eventAgg = await one<Dual<EventAgg>>(
      `WITH base AS (
         SELECT e.id AS id, e.attendance_check AS attendance_check,
                ${HELD_PERIOD("e")} AS held_p
         FROM event e WHERE e.community_id = ?
       ),
       ev AS (
         SELECT b.*,
                ${HELD_EVENT_COUNTS("b")}
         FROM base b
       )
       SELECT
         ${HELD_METRIC_COLUMNS}
       FROM ev`,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
      cid,
    );

    // --- (2) 参加登録: 登録数・キャンセル・出席 ---
    const memberAgg = await one<Dual<RegistrationAgg>>(
      `WITH reg AS (
         ${REGISTRATION_SOURCE("e.community_id = ?")}
       )
       SELECT
         ${REGISTRATION_COLUMNS}
       FROM reg`,
      sinceDay,
      prevSinceDay,
      sinceDay,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
      cid,
    );

    // --- (3) 閲覧（このコミュニティのイベント詳細ページ）---
    // day に索引が無く必ず全走査になるので、期間ごとにスカラーサブクエリを並べず
    // 派生テーブルで今期間・前期間を1度に数える（同じテーブルを2回スキャンしない）
    const viewAgg = await one<Dual<ViewAgg>>(
      `SELECT vu.unique_viewers, vu.prev_unique_viewers,
              vs.total_views, vs.prev_total_views
       FROM (SELECT COUNT(DISTINCT CASE WHEN v.day >= ? THEN v.visitor_id END)
                      AS unique_viewers,
                    COUNT(DISTINCT CASE WHEN v.day >= ? AND v.day < ? THEN v.visitor_id END)
                      AS prev_unique_viewers
               FROM event_view_unique v JOIN event e ON e.id = v.event_id
              WHERE v.day >= ? AND e.community_id = ?) vu,
            (SELECT COALESCE(SUM(CASE WHEN s.day >= ? THEN s.views ELSE 0 END), 0)
                      AS total_views,
                    COALESCE(SUM(CASE WHEN s.day >= ? AND s.day < ? THEN s.views ELSE 0 END), 0)
                      AS prev_total_views
               FROM event_view_stat s JOIN event e ON e.id = s.event_id
              WHERE s.day >= ? AND e.community_id = ?) vs`,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      cid,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      cid,
    );

    // --- (4) 参加の実人数・参加回数の分布・新規流入 vs 常連 ---
    // 「初参加」= その期間の開始日より前に終了したこのコミュニティの公開イベントに
    // 確定参加した記録が無い人。過去分は出席チェックの有無を問わない
    // （登録して来なかった人も「以前から知っている人」なので常連側に置く）。
    // 前期間の初参加は「前期間の開始日より前」で判定するので、判定用の EXISTS を
    // 期間ごとに1本ずつ持つ（同じ人でも基準日が違えば初参加かどうかが変わる）
    const repeatAgg = await one<RepeatRow>(
      `WITH pc AS (
         SELECT uid,
                COUNT(DISTINCT CASE WHEN held_p = 1 THEN eid END) AS n,
                COUNT(DISTINCT CASE WHEN held_p = 2 THEN eid END) AS prev_n,
                MAX(is_new) AS is_new,
                MAX(prev_is_new) AS prev_is_new
         FROM (
           SELECT m.user_id AS uid, m.event_id AS eid, ${HELD_PERIOD("e")} AS held_p,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM event_member pm JOIN event pe ON pe.id = pm.event_id
                     WHERE pm.user_id = m.user_id AND pm.status = 'confirmed'
                       AND ${JOINED("pm")}
                       AND pe.community_id = ? AND pe.status = 'published'
                       AND pe.scheduling = 0 AND pe.ends_at > 0
                       AND ${jd("pe.ends_at")} < ?
                  ) THEN 0 ELSE 1 END AS is_new,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM event_member pm JOIN event pe ON pe.id = pm.event_id
                     WHERE pm.user_id = m.user_id AND pm.status = 'confirmed'
                       AND ${JOINED("pm")}
                       AND pe.community_id = ? AND pe.status = 'published'
                       AND pe.scheduling = 0 AND pe.ends_at > 0
                       AND ${jd("pe.ends_at")} < ?
                  ) THEN 0 ELSE 1 END AS prev_is_new
           FROM event_member m JOIN event e ON e.id = m.event_id
           WHERE ${JOINED_HELD_IN_COMMUNITY_PERIOD("m", "e")}
             AND ${MEMBER_USER_ACTIVE}
         )
         WHERE held_p > 0
         GROUP BY uid
       )
       SELECT ${REPEAT_PEOPLE_COLUMNS},
              COALESCE(SUM(CASE WHEN n >= 1 THEN is_new ELSE 0 END), 0) AS newcomers,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN prev_is_new ELSE 0 END), 0) AS prev_newcomers,
              ${COUNT_BUCKET_COLUMNS}
       FROM pc`,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
      cid,
      sinceDay,
      cid,
      prevSinceDay,
      cid,
    );

    // --- (5) 主催者とコア主催者への依存度（バス係数）---
    const hostAgg = await one<Dual<HostAgg>>(
      `WITH hc AS (
         SELECT uid,
                COUNT(CASE WHEN held_p = 1 THEN 1 END) AS n,
                COUNT(CASE WHEN held_p = 2 THEN 1 END) AS prev_n
         FROM (
           SELECT e.created_by AS uid, ${HELD_PERIOD("e")} AS held_p
           FROM event e
           WHERE e.community_id = ? AND ${USER_ACTIVE("e.created_by")}
         )
         WHERE held_p > 0
         GROUP BY uid
       )
       SELECT ${HOST_COUNT_COLUMNS},
              COALESCE(MAX(n), 0) AS top_host_events,
              COALESCE(MAX(prev_n), 0) AS prev_top_host_events
       FROM hc`,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
      cid,
    );

    // --- (6) 休眠会員率 ---
    // 分母は community_member（明示的にフォローした人）の在籍ユーザー。
    // コミュニティページのメンバー数は「明示メンバー ∪ イベント参加者」なので一致しない。
    // 分母（フォロー人数）は現在のスナップショットなので前期間も同じ値を使う
    // （過去のある時点のフォロー数は復元できない）
    const dormantAgg = await one<Dual<DormantAgg> & DormantSnapshot>(
      `WITH act AS (
         -- 1人が今期間・前期間の両方で参加していることがあるので、
         -- 期間フラグの MAX ではなくフラグを2本立てる（MAX だと 2 に潰れて
         -- 「今期間は休眠」と誤って数えてしまう）
         SELECT uid,
                MAX(CASE WHEN hp = 1 THEN 1 ELSE 0 END) AS cur_active,
                MAX(CASE WHEN hp = 2 THEN 1 ELSE 0 END) AS prev_active
         FROM (
           SELECT m.user_id AS uid, ${HELD_PERIOD("e")} AS hp
           FROM event_member m JOIN event e ON e.id = m.event_id
           WHERE ${JOINED_HELD_IN_COMMUNITY_PERIOD("m", "e")}
         )
         WHERE hp > 0
         GROUP BY uid
       )
       SELECT COUNT(1) AS members,
              COALESCE(SUM(CASE WHEN a.cur_active = 1 THEN 1 ELSE 0 END), 0) AS active_members,
              COALESCE(SUM(CASE WHEN a.prev_active = 1 THEN 1 ELSE 0 END), 0) AS prev_active_members
       FROM community_member c
       LEFT JOIN act a ON a.uid = c.user_id
       WHERE c.community_id = ?
         AND ${USER_ACTIVE("c.user_id")}`,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
      cid,
      cid,
    );

    // --- (7) 参加者の重複度（他コミュニティとの重なり）---
    // 相手側は期間を切らず「これまでに」で見る（連携先を探すのが目的なので、
    // 同じ期間に開催がなかったコミュニティを落とすと使えない）。
    // コミュニティは公開範囲の設定を持たず、一覧もメンバー一覧も未ログインで
    // 見られる公開情報なので、名前を伏せる必要はない。
    // ここは今期間だけ（前期間との比較は出さない）
    const overlapRows = await many<OverlapRow>(
      `WITH p AS (
         SELECT DISTINCT m.user_id AS uid
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE ${JOINED_HELD_IN_COMMUNITY("m", "e")}
           AND ${MEMBER_USER_ACTIVE}
       )
       SELECT c.id AS id, c.slug AS slug, c.name AS name,
              COUNT(DISTINCT m2.user_id) AS users
       FROM p
       JOIN event_member m2 ON m2.user_id = p.uid
            AND m2.status = 'confirmed' AND ${JOINED("m2")}
       JOIN event e2 ON e2.id = m2.event_id AND e2.status = 'published'
            AND e2.community_id IS NOT NULL AND e2.community_id <> ?
       JOIN community c ON c.id = e2.community_id
       GROUP BY c.id, c.slug, c.name
       ORDER BY users DESC, c.name ASC
       LIMIT 5`,
      now,
      sinceDay,
      cid,
      cid,
    );

    // --- (8) 開催と参加の日次推移 (#266) ---
    // 全体KPIの日次推移と同じ数え方で、開催日 (ends_at) の日に立てる
    const daily = await many<DailyRow>(
      `SELECT day, SUM(held_events) AS held_events, SUM(participations) AS participations
       FROM (
         SELECT ${jd("e.ends_at")} AS day, 1 AS held_events, 0 AS participations
         ${DAILY_HELD_EVENTS(" AND e.community_id = ?")}
         UNION ALL
         SELECT ${jd("e.ends_at")}, 0, 1
         ${DAILY_PARTICIPATIONS(" AND e.community_id = ?")}
       )
       GROUP BY day ORDER BY day`,
      now,
      sinceDay,
      cid,
      now,
      sinceDay,
      cid,
    );

    return buildPayload({
      community,
      days,
      sinceDay,
      prevSinceDay,
      today,
      eventAgg,
      memberAgg,
      viewAgg,
      repeatAgg,
      hostAgg,
      dormantAgg,
      overlapRows,
      daily,
    });
  },
};

/** 1つの期間ぶんの指標。今期間・前期間の両方でこの関数を通すので、
 * 片方だけ数え方や母数ゲートがずれることがない。
 * 全体KPIにも出るタイルは sharedMetrics()（＝kpi.ts と同じ式）。
 * こちらは母数が小さいので、率のゲートに rateMin を渡す */
function periodMetrics(
  s: {
    event: AggPick<EventAgg>;
    member: AggPick<RegistrationAgg>;
    view: AggPick<ViewAgg>;
    repeat: AggPick<RepeatAgg>;
    host: AggPick<HostAgg>;
    dormant: AggPick<DormantAgg>;
  },
  members: number,
  /** 全期間（days=null）は「期間より前」が無く全員が初参加になるトートロジー */
  allTime: boolean,
) {
  const shared = sharedMetrics(s, rateMin);

  const people = shared.uniqueParticipants;
  const newcomers = s.repeat("newcomers");
  const topHostEvents = s.host("top_host_events");
  const activeMembers = s.dormant("active_members");

  return {
    ...shared,

    topHostEvents,
    topHostShare: rateMin(topHostEvents, shared.heldEventsWithActiveHost),

    newcomers,
    regulars: people - newcomers,
    // 全期間は「期間より前」が存在しないので全員が初参加になり、率は必ず 100%
    // （トートロジー）。他の期間と同じ見た目で出すと誤読されるので出さない
    newcomerRate: allTime ? null : rateMin(newcomers, people),

    members,
    activeMembers,
    dormantMembers: members - activeMembers,
    dormantRate: rateMin(members - activeMembers, members),
  };
}

type PeriodMetrics = ReturnType<typeof periodMetrics>;

/** 画面のタイルに前期間比を出す指標だけ取り出す。
 * キーは @eventer/shared の KPI_METRICS（方向の定義）と1対1 */
function previousValues(m: PeriodMetrics): KpiPreviousValues {
  return {
    participations: m.participations,
    heldEvents: m.heldEvents,
    avgParticipantsPerEvent: m.avgParticipantsPerEvent,
    dudRate: m.dudRate,
    registrations: m.registrations,
    confirmedRegistrations: m.confirmedRegistrations,
    uniqueViewers: m.uniqueViewers,
    totalViews: m.totalViews,
    viewToJoinRate: m.viewToJoinRate,
    attendanceRate: m.attendanceRate,
    noShowRate: m.noShowRate,
    cancelRate: m.cancelRate,
    lateCancelRate: m.lateCancelRate,
    repeatRate: m.repeatRate,
    uniqueParticipants: m.uniqueParticipants,
    hosts: m.hosts,
    repeatHostRate: m.repeatHostRate,
    avgEventsPerHost: m.avgEventsPerHost,
    topHostShare: m.topHostShare,
    newcomers: m.newcomers,
    regulars: m.regulars,
    newcomerRate: m.newcomerRate,
    members: m.members,
    activeMembers: m.activeMembers,
    dormantRate: m.dormantRate,
  };
}

/** 日次推移を抜けの無い日付に整える（活動ゼロの日は 0）。
 * 上限を超える長さのときは古い側を切る（新しい側を必ず残す）。
 * @param from 期間の開始日。'0000'（全期間）のときはデータのある最初の日 */
function fillDaily(
  from: string,
  today: string,
  rows: DailyRow[],
): CommunityKpiDailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const start = from !== "0000" ? from : rows[0]?.day;
  if (!start || start > today) return [];
  const first = clampSeriesStart(start, today);
  const out: CommunityKpiDailyPoint[] = [];
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const r = byDay.get(day);
    out.push({
      day,
      heldEvents: N(r?.held_events),
      participations: N(r?.participations),
    });
  }
  return out;
}

function buildPayload(src: {
  community: { id: string; slug: string; name: string };
  days: number | null;
  sinceDay: string;
  prevSinceDay: string;
  today: string;
  eventAgg: Dual<EventAgg> | null;
  memberAgg: Dual<RegistrationAgg> | null;
  viewAgg: Dual<ViewAgg> | null;
  repeatAgg: RepeatRow | null;
  hostAgg: Dual<HostAgg> | null;
  dormantAgg: (Dual<DormantAgg> & DormantSnapshot) | null;
  overlapRows: OverlapRow[];
  daily: DailyRow[];
}): CommunityKpiPayload {
  const members = N(src.dormantAgg?.members);
  const sources = (prefix: "" | "prev_") => ({
    event: picker<EventAgg>(src.eventAgg, prefix),
    member: picker<RegistrationAgg>(src.memberAgg, prefix),
    view: picker<ViewAgg>(src.viewAgg, prefix),
    repeat: picker<RepeatAgg>(src.repeatAgg, prefix),
    host: picker<HostAgg>(src.hostAgg, prefix),
    dormant: picker<DormantAgg>(src.dormantAgg, prefix),
  });
  const m = periodMetrics(sources(""), members, src.days === null);
  const previous =
    src.days === null
      ? null
      : previousValues(periodMetrics(sources("prev_"), members, false));

  // 重なっている人数が少ない行は出さない。コミュニティのメンバー一覧は誰でも
  // 見られるので、「1人が重なっています（@dee）」まで出すと突き合わせで
  // 個人が特定できてしまう（率だけ隠しても人数から復元できる）。
  // users <= people なので、残った行の rate は実質いつも算出できる
  // （rateMin は分母の定義が変わったときの保険として残す）
  const overlap: CommunityKpiOverlapItem[] = src.overlapRows
    .filter((r) => r.users >= COMMUNITY_KPI_MIN_SAMPLE)
    .map((r) => ({
      communityId: r.id,
      slug: r.slug,
      name: r.name,
      users: r.users,
      rate: rateMin(r.users, m.uniqueParticipants),
    }));

  return {
    days: src.days,
    sinceDay: src.sinceDay,
    previous,
    previousSinceDay: src.days === null ? null : src.prevSinceDay,
    daily: fillDaily(src.sinceDay, src.today, src.daily),
    community: src.community,
    minSample: COMMUNITY_KPI_MIN_SAMPLE,
    northStar: {
      participations: m.participations,
      heldParticipants: m.heldParticipants,
      heldEvents: m.heldEvents,
      avgParticipantsPerEvent: m.avgParticipantsPerEvent,
    },
    participants: {
      registrations: m.registrations,
      confirmedRegistrations: m.confirmedRegistrations,
      uniqueViewers: m.uniqueViewers,
      totalViews: m.totalViews,
      viewToJoinRate: m.viewToJoinRate,
      attendanceExpected: m.attendanceExpected,
      attended: m.attended,
      attendanceRate: m.attendanceRate,
      noShowRate: m.noShowRate,
      canceled: m.canceled,
      cancelRate: m.cancelRate,
      canceledLate: m.canceledLate,
      canceledEarly: m.canceledEarly,
      lateCancelRate: m.lateCancelRate,
      uniqueParticipants: m.uniqueParticipants,
      repeatParticipants: m.repeatParticipants,
      repeatRate: m.repeatRate,
      countDistribution: countDistribution(src.repeatAgg),
    },
    organizers: {
      heldEvents: m.heldEvents,
      dudEvents: m.dudEvents,
      attendanceUnrecordedEvents: m.attendanceUnrecordedEvents,
      dudBaseEvents: m.dudBaseEvents,
      dudRate: m.dudRate,
      hosts: m.hosts,
      heldEventsWithActiveHost: m.heldEventsWithActiveHost,
      repeatHosts: m.repeatHosts,
      repeatHostRate: m.repeatHostRate,
      avgEventsPerHost: m.avgEventsPerHost,
      topHostEvents: m.topHostEvents,
      topHostShare: m.topHostShare,
    },
    newcomers: {
      participants: m.uniqueParticipants,
      newcomers: m.newcomers,
      regulars: m.regulars,
      newcomerRate: m.newcomerRate,
    },
    dormant: {
      members: m.members,
      activeMembers: m.activeMembers,
      dormantMembers: m.dormantMembers,
      dormantRate: m.dormantRate,
    },
    overlap,
  };
}
