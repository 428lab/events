import {
  COMMUNITY_KPI_MIN_SAMPLE,
  type CommunityKpiDailyPoint,
  type CommunityKpiOverlapItem,
  type CommunityKpiPayload,
  type KpiDistributionBucket,
  type KpiPreviousValues,
} from "@eventer/shared";
import { many, one } from "../client.js";
import {
  ATTENDANCE_UNRECORDED,
  type AggPick,
  DAY_PERIOD,
  type Dual,
  HELD,
  HELD_PERIOD,
  JOINED,
  MEMBER_USER_ACTIVE,
  N,
  USER_ACTIVE,
  dual,
  jd,
  jstDay,
  picker,
  rate,
} from "./kpi.js";

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

interface EventAgg {
  held_events: number;
  held_participations: number;
  held_participants: number;
  dud_events: number;
  attendance_unrecorded_events: number;
}

interface MemberAgg {
  registrations: number;
  confirmed_registrations: number;
  canceled: number;
  canceled_late: number;
  attendance_expected: number;
  attended: number;
}

interface ViewAgg {
  unique_viewers: number;
  total_views: number;
}

interface RepeatAgg {
  people: number;
  repeaters: number;
  newcomers: number;
}

/** 参加回数の分布は今期間ぶんだけ */
interface RepeatRow extends Dual<RepeatAgg> {
  c1: number;
  c2: number;
  c3: number;
  c45: number;
  c610: number;
  c11: number;
}

interface HostAgg {
  hosts: number;
  repeat_hosts: number;
  total_held: number;
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
  /** コミュニティ運営者向けのKPI (#262)。数え方は全体KPI (kpi.ts) と同じヘルパーを
   * 使っており、同じ期間なら community KPI の各数字は全体KPIの部分集合になる。
   * Workers のサブリクエスト上限を意識して 9 本にまとめている
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
                CASE WHEN b.held_p > 0 THEN (
                  -- イベントページの participantCount と同じ定義（主催・スタッフを含む）
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = b.id AND em.status = 'confirmed'
                     AND (b.attendance_check = 0 OR em.attended = 1 OR em.role <> 'participant')
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS pcount,
                CASE WHEN b.held_p > 0 THEN (
                  -- 不発判定用。主催・スタッフを含めるとチーム規模でしきい値がぶれる
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = b.id AND em.status = 'confirmed'
                     AND ${JOINED("em")}
                     AND (b.attendance_check = 0 OR em.attended = 1)
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS ppl,
                CASE WHEN b.held_p > 0 AND b.attendance_check = 1
                       AND ${ATTENDANCE_UNRECORDED("b.id")}
                     THEN 1 ELSE 0 END AS unrecorded
         FROM base b
       )
       SELECT
         ${dual("held_events", "held_p")},
         ${dual("held_participations", "held_p", undefined, "pcount")},
         ${dual("held_participants", "held_p", undefined, "ppl")},
         ${dual("dud_events", "held_p", "unrecorded = 0 AND ppl <= 3")},
         ${dual("attendance_unrecorded_events", "held_p", "unrecorded = 1")}
       FROM ev`,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
      cid,
    );

    // --- (2) 参加登録: 登録数・キャンセル・出席 ---
    const memberAgg = await one<Dual<MemberAgg>>(
      `WITH reg AS (
         SELECT ${DAY_PERIOD(jd("m.created_at"))} AS reg_p,
                ${HELD_PERIOD("e")} AS held_p,
                m.status AS status, m.attended AS attended,
                m.canceled_scheduling AS canceled_scheduling,
                m.canceled_at AS canceled_at,
                e.scheduling AS e_scheduling, e.starts_at AS e_starts_at,
                e.attendance_check AS e_attendance_check
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE ${JOINED("m")} AND e.status = 'published' AND ${MEMBER_USER_ACTIVE}
           AND e.community_id = ?
       )
       SELECT
         ${dual("registrations", "reg_p")},
         ${dual("confirmed_registrations", "reg_p", "status = 'confirmed'")},
         ${dual("canceled", "reg_p", "status = 'canceled' AND canceled_scheduling = 0")},
         ${dual("canceled_late", "reg_p", "status = 'canceled' AND canceled_scheduling = 0 AND e_scheduling = 0 AND canceled_at >= e_starts_at - 86400000")},
         ${dual("attendance_expected", "held_p", "e_attendance_check = 1 AND status = 'confirmed'")},
         ${dual("attended", "held_p", "e_attendance_check = 1 AND status = 'confirmed' AND attended = 1")}
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
    const viewAgg = await one<Dual<ViewAgg>>(
      `SELECT
         (SELECT COUNT(DISTINCT CASE WHEN v.day >= ? THEN v.visitor_id END)
            FROM event_view_unique v JOIN event e ON e.id = v.event_id
           WHERE v.day >= ? AND e.community_id = ?) AS unique_viewers,
         (SELECT COUNT(DISTINCT CASE WHEN v.day >= ? AND v.day < ? THEN v.visitor_id END)
            FROM event_view_unique v JOIN event e ON e.id = v.event_id
           WHERE v.day >= ? AND e.community_id = ?) AS prev_unique_viewers,
         (SELECT COALESCE(SUM(CASE WHEN s.day >= ? THEN s.views ELSE 0 END), 0)
            FROM event_view_stat s JOIN event e ON e.id = s.event_id
           WHERE s.day >= ? AND e.community_id = ?) AS total_views,
         (SELECT COALESCE(SUM(CASE WHEN s.day >= ? AND s.day < ? THEN s.views ELSE 0 END), 0)
            FROM event_view_stat s JOIN event e ON e.id = s.event_id
           WHERE s.day >= ? AND e.community_id = ?) AS prev_total_views`,
      sinceDay,
      prevSinceDay,
      cid,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      cid,
      sinceDay,
      prevSinceDay,
      cid,
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
       SELECT COALESCE(SUM(CASE WHEN n >= 1 THEN 1 ELSE 0 END), 0) AS people,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN 1 ELSE 0 END), 0) AS prev_people,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeaters,
              COALESCE(SUM(CASE WHEN prev_n >= 2 THEN 1 ELSE 0 END), 0) AS prev_repeaters,
              COALESCE(SUM(CASE WHEN n >= 1 THEN is_new ELSE 0 END), 0) AS newcomers,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN prev_is_new ELSE 0 END), 0) AS prev_newcomers,
              COALESCE(SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END), 0) AS c1,
              COALESCE(SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END), 0) AS c2,
              COALESCE(SUM(CASE WHEN n = 3 THEN 1 ELSE 0 END), 0) AS c3,
              COALESCE(SUM(CASE WHEN n BETWEEN 4 AND 5 THEN 1 ELSE 0 END), 0) AS c45,
              COALESCE(SUM(CASE WHEN n BETWEEN 6 AND 10 THEN 1 ELSE 0 END), 0) AS c610,
              COALESCE(SUM(CASE WHEN n >= 11 THEN 1 ELSE 0 END), 0) AS c11
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
       SELECT COALESCE(SUM(CASE WHEN n >= 1 THEN 1 ELSE 0 END), 0) AS hosts,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN 1 ELSE 0 END), 0) AS prev_hosts,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeat_hosts,
              COALESCE(SUM(CASE WHEN prev_n >= 2 THEN 1 ELSE 0 END), 0) AS prev_repeat_hosts,
              COALESCE(SUM(n), 0) AS total_held,
              COALESCE(SUM(prev_n), 0) AS prev_total_held,
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
         FROM event e WHERE ${HELD("e")} AND e.community_id = ?
         UNION ALL
         SELECT ${jd("e.ends_at")}, 0, 1
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE m.status = 'confirmed'
           AND (e.attendance_check = 0 OR m.attended = 1 OR m.role <> 'participant')
           AND ${MEMBER_USER_ACTIVE} AND ${HELD("e")} AND e.community_id = ?
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
 * 片方だけ数え方や母数ゲートがずれることがない */
function periodMetrics(
  s: {
    event: AggPick<EventAgg>;
    member: AggPick<MemberAgg>;
    view: AggPick<ViewAgg>;
    repeat: AggPick<RepeatAgg>;
    host: AggPick<HostAgg>;
    dormant: AggPick<DormantAgg>;
  },
  members: number,
  /** 全期間（days=null）は「期間より前」が無く全員が初参加になるトートロジー */
  allTime: boolean,
) {
  const heldEvents = s.event("held_events");
  const participations = s.event("held_participations");
  const attendanceUnrecordedEvents = s.event("attendance_unrecorded_events");
  const dudEvents = s.event("dud_events");
  const dudBaseEvents = heldEvents - attendanceUnrecordedEvents;

  const registrations = s.member("registrations");
  const canceled = s.member("canceled");
  const canceledLate = s.member("canceled_late");
  const attendanceExpected = s.member("attendance_expected");
  const attended = s.member("attended");
  const attendanceRate = rate(attended, attendanceExpected);

  const uniqueViewers = s.view("unique_viewers");
  const people = s.repeat("people");
  const repeaters = s.repeat("repeaters");
  const newcomers = s.repeat("newcomers");

  const hosts = s.host("hosts");
  const heldEventsWithActiveHost = s.host("total_held");
  const repeatHosts = s.host("repeat_hosts");
  const topHostEvents = s.host("top_host_events");

  const activeMembers = s.dormant("active_members");

  return {
    participations,
    heldParticipants: s.event("held_participants"),
    heldEvents,
    avgParticipantsPerEvent: rate(participations, heldEvents),

    registrations,
    confirmedRegistrations: s.member("confirmed_registrations"),
    uniqueViewers,
    totalViews: s.view("total_views"),
    viewToJoinRate: rate(registrations, uniqueViewers),
    attendanceExpected,
    attended,
    attendanceRate,
    noShowRate: attendanceRate === null ? null : 1 - attendanceRate,
    canceled,
    cancelRate: rate(canceled, registrations),
    canceledLate,
    canceledEarly: canceled - canceledLate,
    lateCancelRate: rate(canceledLate, canceled),
    uniqueParticipants: people,
    repeatParticipants: repeaters,
    // 分母は新規流入と同じ「期間内に参加した実人数」。全体KPIでは素の rate だが、
    // ここは新規流入と同じセクションに並ぶので同じゲートを通す
    repeatRate: rateMin(repeaters, people),

    dudEvents,
    attendanceUnrecordedEvents,
    dudBaseEvents,
    // 開催1件で1件が不発なら100% になる。立ち上げ期の主催者が最初に見る数字なので
    // 特にゲートを効かせる（件数はそのまま出す）
    dudRate: rateMin(dudEvents, dudBaseEvents),
    hosts,
    heldEventsWithActiveHost,
    repeatHosts,
    repeatHostRate: rateMin(repeatHosts, hosts),
    // 平均は「率」ではなく件数÷人数の目安なので、母数ゲートは掛けない
    avgEventsPerHost: rate(heldEventsWithActiveHost, hosts),
    topHostEvents,
    topHostShare: rateMin(topHostEvents, heldEventsWithActiveHost),

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
 * @param from 期間の開始日。'0000'（全期間）のときはデータのある最初の日 */
function fillDaily(
  from: string,
  today: string,
  rows: DailyRow[],
): CommunityKpiDailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const first = from !== "0000" ? from : rows[0]?.day;
  if (!first || first > today) return [];
  const out: CommunityKpiDailyPoint[] = [];
  for (let day = first; day <= today; day = addDay(day)) {
    const r = byDay.get(day);
    out.push({
      day,
      heldEvents: N(r?.held_events),
      participations: N(r?.participations),
    });
    if (out.length > 3000) break;
  }
  return out;
}

function addDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);
}

function buildPayload(src: {
  community: { id: string; slug: string; name: string };
  days: number | null;
  sinceDay: string;
  prevSinceDay: string;
  today: string;
  eventAgg: Dual<EventAgg> | null;
  memberAgg: Dual<MemberAgg> | null;
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
    member: picker<MemberAgg>(src.memberAgg, prefix),
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

  const cur = src.repeatAgg;
  const countDistribution: KpiDistributionBucket[] = [
    { label: "1回", users: N(cur?.c1) },
    { label: "2回", users: N(cur?.c2) },
    { label: "3回", users: N(cur?.c3) },
    { label: "4〜5回", users: N(cur?.c45) },
    { label: "6〜10回", users: N(cur?.c610) },
    { label: "11回以上", users: N(cur?.c11) },
  ];

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
      countDistribution,
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
