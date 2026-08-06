import {
  COMMUNITY_KPI_MIN_SAMPLE,
  type CommunityKpiOverlapItem,
  type CommunityKpiPayload,
  type KpiDistributionBucket,
} from "@eventer/shared";
import { many, one } from "../client.js";
import {
  ATTENDANCE_UNRECORDED,
  HELD,
  JOINED,
  MEMBER_USER_ACTIVE,
  N,
  USER_ACTIVE,
  jd,
  rate,
} from "./kpi.js";

/** 母数が小さいときは率を出さない。3人中1人が新規で 33% のように極端に振れて、
 * 主催者の評価のように誤読されるのを防ぐ（画面は「母数が少ないため非表示」）。
 *
 * コミュニティKPIの画面に出る「率」はすべてこれを通す。件数と平均は素のまま出す
 * （画面の注記も「率だけ隠す」と書いてあるので、率を1つでも素通しにすると
 * 同じセクション内で基準が食い違って見える）。
 * 分母は「人数」とは限らない（不発率・主催シェアはイベント件数）。同じ定数を
 * 人数にも件数にも使っているのは、どちらも1つ増減しただけで率が大きく動くため。 */
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
  top_host_events: number | null;
}

interface DormantAgg {
  members: number;
  active_members: number;
}

interface OverlapRow {
  id: string;
  slug: string;
  name: string;
  users: number;
}

export const communityKpiRepo = {
  /** コミュニティ運営者向けのKPI (#262)。数え方は全体KPI (kpi.ts) と同じヘルパーを
   * 使っており、同じ期間なら community KPI の各数字は全体KPIの部分集合になる。
   * Workers のサブリクエスト上限を意識して 7 本にまとめている。 */
  async overview(
    community: { id: string; slug: string; name: string },
    sinceDay: string,
    days: number | null,
  ): Promise<CommunityKpiPayload> {
    const now = Date.now();
    const cid = community.id;

    // --- (1) イベント: 北極星・不発率 ---
    // ?の並びは SQL の字面の順。HELD は SELECT 句の中に出るので
    // WHERE の community_id より先にバインドする
    const eventAgg = await one<EventAgg>(
      `WITH base AS (
         SELECT e.id AS id, e.attendance_check AS attendance_check, ${HELD("e")} AS held
         FROM event e WHERE e.community_id = ?
       ),
       ev AS (
         SELECT b.*,
                CASE WHEN b.held THEN (
                  -- イベントページの participantCount と同じ定義（主催・スタッフを含む）
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = b.id AND em.status = 'confirmed'
                     AND (b.attendance_check = 0 OR em.attended = 1 OR em.role <> 'participant')
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS pcount,
                CASE WHEN b.held THEN (
                  -- 不発判定用。主催・スタッフを含めるとチーム規模でしきい値がぶれる
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = b.id AND em.status = 'confirmed'
                     AND ${JOINED("em")}
                     AND (b.attendance_check = 0 OR em.attended = 1)
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS ppl,
                CASE WHEN b.held AND b.attendance_check = 1
                       AND ${ATTENDANCE_UNRECORDED("b.id")}
                     THEN 1 ELSE 0 END AS unrecorded
         FROM base b
       )
       SELECT
         COALESCE(SUM(CASE WHEN held THEN 1 ELSE 0 END), 0) AS held_events,
         COALESCE(SUM(CASE WHEN held THEN pcount ELSE 0 END), 0) AS held_participations,
         COALESCE(SUM(CASE WHEN held THEN ppl ELSE 0 END), 0) AS held_participants,
         COALESCE(SUM(CASE WHEN held AND unrecorded = 0 AND ppl <= 3 THEN 1 ELSE 0 END), 0) AS dud_events,
         COALESCE(SUM(CASE WHEN held AND unrecorded = 1 THEN 1 ELSE 0 END), 0) AS attendance_unrecorded_events
       FROM ev`,
      now,
      sinceDay,
      cid,
    );

    // --- (2) 参加登録: 登録数・キャンセル・出席 ---
    const memberAgg = await one<MemberAgg>(
      `SELECT
         COALESCE(SUM(CASE WHEN ${jd("m.created_at")} >= ? THEN 1 ELSE 0 END), 0) AS registrations,
         COALESCE(SUM(CASE WHEN ${jd("m.created_at")} >= ? AND m.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_registrations,
         COALESCE(SUM(CASE WHEN ${jd("m.created_at")} >= ? AND m.status = 'canceled' AND m.canceled_scheduling = 0 THEN 1 ELSE 0 END), 0) AS canceled,
         COALESCE(SUM(CASE WHEN ${jd("m.created_at")} >= ? AND m.status = 'canceled' AND m.canceled_scheduling = 0
                             AND e.scheduling = 0 AND m.canceled_at >= e.starts_at - 86400000 THEN 1 ELSE 0 END), 0) AS canceled_late,
         COALESCE(SUM(CASE WHEN ${HELD("e")} AND e.attendance_check = 1
                             AND m.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS attendance_expected,
         COALESCE(SUM(CASE WHEN ${HELD("e")} AND e.attendance_check = 1
                             AND m.status = 'confirmed' AND m.attended = 1 THEN 1 ELSE 0 END), 0) AS attended
       FROM event_member m JOIN event e ON e.id = m.event_id
       WHERE ${JOINED("m")} AND e.status = 'published' AND ${MEMBER_USER_ACTIVE}
         AND e.community_id = ?`,
      sinceDay,
      sinceDay,
      sinceDay,
      sinceDay,
      now,
      sinceDay,
      now,
      sinceDay,
      cid,
    );

    // --- (3) 閲覧（このコミュニティのイベント詳細ページ）---
    const viewAgg = await one<ViewAgg>(
      `SELECT
         (SELECT COUNT(DISTINCT v.visitor_id) FROM event_view_unique v
            JOIN event e ON e.id = v.event_id
           WHERE v.day >= ? AND e.community_id = ?) AS unique_viewers,
         (SELECT COALESCE(SUM(s.views), 0) FROM event_view_stat s
            JOIN event e ON e.id = s.event_id
           WHERE s.day >= ? AND e.community_id = ?) AS total_views`,
      sinceDay,
      cid,
      sinceDay,
      cid,
    );

    // --- (4) 参加の実人数・参加回数の分布・新規流入 vs 常連 ---
    // 「初参加」= 期間開始日より前に終了したこのコミュニティの公開イベントに
    // 確定参加した記録が無い人。過去分は出席チェックの有無を問わない
    // （登録して来なかった人も「以前から知っている人」なので常連側に置く）
    const repeatAgg = await one<RepeatAgg>(
      `WITH pc AS (
         SELECT m.user_id AS uid, COUNT(DISTINCT m.event_id) AS n,
                CASE WHEN EXISTS (
                  SELECT 1 FROM event_member pm JOIN event pe ON pe.id = pm.event_id
                   WHERE pm.user_id = m.user_id AND pm.status = 'confirmed'
                     AND ${JOINED("pm")}
                     AND pe.community_id = ? AND pe.status = 'published'
                     AND pe.scheduling = 0 AND pe.ends_at > 0
                     AND ${jd("pe.ends_at")} < ?
                ) THEN 0 ELSE 1 END AS is_new
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE ${JOINED_HELD_IN_COMMUNITY("m", "e")}
           AND ${MEMBER_USER_ACTIVE}
         GROUP BY m.user_id
       )
       SELECT COUNT(1) AS people,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeaters,
              COALESCE(SUM(is_new), 0) AS newcomers,
              COALESCE(SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END), 0) AS c1,
              COALESCE(SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END), 0) AS c2,
              COALESCE(SUM(CASE WHEN n = 3 THEN 1 ELSE 0 END), 0) AS c3,
              COALESCE(SUM(CASE WHEN n BETWEEN 4 AND 5 THEN 1 ELSE 0 END), 0) AS c45,
              COALESCE(SUM(CASE WHEN n BETWEEN 6 AND 10 THEN 1 ELSE 0 END), 0) AS c610,
              COALESCE(SUM(CASE WHEN n >= 11 THEN 1 ELSE 0 END), 0) AS c11
       FROM pc`,
      cid,
      sinceDay,
      now,
      sinceDay,
      cid,
    );

    // --- (5) 主催者とコア主催者への依存度（バス係数）---
    const hostAgg = await one<HostAgg>(
      `WITH hc AS (
         SELECT e.created_by AS uid, COUNT(1) AS n
         FROM event e
         WHERE ${HELD("e")} AND e.community_id = ?
           AND ${USER_ACTIVE("e.created_by")}
         GROUP BY e.created_by
       )
       SELECT COUNT(1) AS hosts,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeat_hosts,
              COALESCE(SUM(n), 0) AS total_held,
              MAX(n) AS top_host_events
       FROM hc`,
      now,
      sinceDay,
      cid,
    );

    // --- (6) 休眠会員率 ---
    // 分母は community_member（明示的にフォローした人）の在籍ユーザー。
    // コミュニティページのメンバー数は「明示メンバー ∪ イベント参加者」なので一致しない
    const dormantAgg = await one<DormantAgg>(
      `SELECT COUNT(1) AS members,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM event_member m JOIN event e ON e.id = m.event_id
                 WHERE m.user_id = cm.user_id
                   AND ${JOINED_HELD_IN_COMMUNITY("m", "e")}
              ) THEN 1 ELSE 0 END), 0) AS active_members
       FROM community_member cm
       WHERE cm.community_id = ?
         AND ${USER_ACTIVE("cm.user_id")}`,
      now,
      sinceDay,
      cid,
      cid,
    );

    // --- (7) 参加者の重複度（他コミュニティとの重なり）---
    // 相手側は期間を切らず「これまでに」で見る（連携先を探すのが目的なので、
    // 同じ期間に開催がなかったコミュニティを落とすと使えない）。
    // コミュニティは公開範囲の設定を持たず、一覧もメンバー一覧も未ログインで
    // 見られる公開情報なので、名前を伏せる必要はない
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

    return buildPayload({
      community,
      days,
      sinceDay,
      eventAgg,
      memberAgg,
      viewAgg,
      repeatAgg,
      hostAgg,
      dormantAgg,
      overlapRows,
    });
  },
};

function buildPayload(src: {
  community: { id: string; slug: string; name: string };
  days: number | null;
  sinceDay: string;
  eventAgg: EventAgg | null;
  memberAgg: MemberAgg | null;
  viewAgg: ViewAgg | null;
  repeatAgg: RepeatAgg | null;
  hostAgg: HostAgg | null;
  dormantAgg: DormantAgg | null;
  overlapRows: OverlapRow[];
}): CommunityKpiPayload {
  const heldEvents = N(src.eventAgg?.held_events);
  const participations = N(src.eventAgg?.held_participations);
  const heldParticipants = N(src.eventAgg?.held_participants);
  const dudEvents = N(src.eventAgg?.dud_events);
  const attendanceUnrecordedEvents = N(
    src.eventAgg?.attendance_unrecorded_events,
  );
  const dudBaseEvents = heldEvents - attendanceUnrecordedEvents;

  const registrations = N(src.memberAgg?.registrations);
  const canceled = N(src.memberAgg?.canceled);
  const canceledLate = N(src.memberAgg?.canceled_late);
  const attendanceExpected = N(src.memberAgg?.attendance_expected);
  const attended = N(src.memberAgg?.attended);
  const attendanceRate = rate(attended, attendanceExpected);

  const uniqueViewers = N(src.viewAgg?.unique_viewers);

  const people = N(src.repeatAgg?.people);
  const repeaters = N(src.repeatAgg?.repeaters);
  const newcomers = N(src.repeatAgg?.newcomers);
  const countDistribution: KpiDistributionBucket[] = [
    { label: "1回", users: N(src.repeatAgg?.c1) },
    { label: "2回", users: N(src.repeatAgg?.c2) },
    { label: "3回", users: N(src.repeatAgg?.c3) },
    { label: "4〜5回", users: N(src.repeatAgg?.c45) },
    { label: "6〜10回", users: N(src.repeatAgg?.c610) },
    { label: "11回以上", users: N(src.repeatAgg?.c11) },
  ];

  const hosts = N(src.hostAgg?.hosts);
  const heldEventsWithActiveHost = N(src.hostAgg?.total_held);
  const topHostEvents = N(src.hostAgg?.top_host_events);

  const members = N(src.dormantAgg?.members);
  const activeMembers = N(src.dormantAgg?.active_members);

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
      rate: rateMin(r.users, people),
    }));

  return {
    days: src.days,
    sinceDay: src.sinceDay,
    community: src.community,
    minSample: COMMUNITY_KPI_MIN_SAMPLE,
    northStar: {
      participations,
      heldParticipants,
      heldEvents,
      avgParticipantsPerEvent: rate(participations, heldEvents),
    },
    participants: {
      registrations,
      confirmedRegistrations: N(src.memberAgg?.confirmed_registrations),
      uniqueViewers,
      totalViews: N(src.viewAgg?.total_views),
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
      countDistribution,
    },
    organizers: {
      heldEvents,
      dudEvents,
      attendanceUnrecordedEvents,
      dudBaseEvents,
      // 開催1件で1件が不発なら100% になる。立ち上げ期の主催者が最初に見る数字なので
      // 特にゲートを効かせる（件数はそのまま出す）
      dudRate: rateMin(dudEvents, dudBaseEvents),
      hosts,
      heldEventsWithActiveHost,
      repeatHosts: N(src.hostAgg?.repeat_hosts),
      repeatHostRate: rateMin(N(src.hostAgg?.repeat_hosts), hosts),
      // 平均は「率」ではなく件数÷人数の目安なので、母数ゲートは掛けない
      avgEventsPerHost: rate(heldEventsWithActiveHost, hosts),
      topHostEvents,
      topHostShare: rateMin(topHostEvents, heldEventsWithActiveHost),
    },
    newcomers: {
      participants: people,
      newcomers,
      regulars: people - newcomers,
      // 全期間は「期間より前」が存在しないので全員が初参加になり、率は必ず 100%
      // （トートロジー）。他の期間と同じ見た目で出すと誤読されるので出さない
      newcomerRate:
        src.days === null ? null : rateMin(newcomers, people),
    },
    dormant: {
      members,
      activeMembers,
      dormantMembers: members - activeMembers,
      dormantRate: rateMin(members - activeMembers, members),
    },
    overlap,
  };
}
