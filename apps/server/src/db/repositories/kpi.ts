import type {
  KpiDailyPoint,
  KpiDistributionBucket,
  KpiPayload,
  KpiProviderCount,
} from "@eventer/shared";
import { many, one } from "../client.js";

/** epoch ms のカラムを JST の 'YYYY-MM-DD' に。既存の jstDay() と同じ基準 */
export function jd(col: string): string {
  return `strftime('%Y-%m-%d', ${col} / 1000 + 32400, 'unixepoch')`;
}

/** 率。分母0は null（画面は「—」表示）。NaN/Infinity を返さない */
export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** 退会申請中 (#250) を除く条件。成長・定着系の分母から外す */
export const MEMBER_USER_ACTIVE =
  "EXISTS (SELECT 1 FROM user u WHERE u.id = m.user_id AND u.deleted_at IS NULL)";

/** 退会申請中 (#250) を除く条件（任意のユーザーID列に対して） */
export const USER_ACTIVE = (col: string) =>
  `EXISTS (SELECT 1 FROM user u WHERE u.id = ${col} AND u.deleted_at IS NULL)`;

/** 「参加した人」の行の条件。除くのは運営側の staff 行だけで、
 * 審査員 (judge)・観覧者 (observer) は実際にイベントに来る人なので参加者として数える。
 * staff を除くのは、イベント作成時に作成者の staff 行が必ず作られるため
 * （絞らないとイベントを1件作るたびに参加登録が +1 される）。 */
export const JOINED = (t: string) => `${t}.role <> 'staff'`;

/** 出席チェックを有効にしたのに出席記録が1件も無いイベント（＝運営が記録し忘れた）。
 * 参加者数が 0 と出てしまうため、不発率の分母から外す。バインド不要 */
export const ATTENDANCE_UNRECORDED = (idCol: string) =>
  `NOT EXISTS (SELECT 1 FROM event_member em WHERE em.event_id = ${idCol} AND em.attended = 1)`;

/** 開催済み（期間内に終了した公開イベント・日程確定済み）の条件。
 * ends_at = 0（開催日未設定）を除くのは既存の集計（eventMembers.participationStats,
 * events.isEventEnded）と揃えるため。除かないと全期間指定で日付未設定イベントが
 * 「開催完了」に混ざる。
 * バインド順: now, sinceDay */
export const HELD = (t: string) =>
  `(${t}.status = 'published' AND ${t}.scheduling = 0 AND ${t}.ends_at > 0 AND ${t}.ends_at < ? AND ${jd(`${t}.ends_at`)} >= ?)`;

export const N = (v: number | null | undefined): number => v ?? 0;

interface EventAgg {
  held_events: number;
  held_participations: number;
  held_participants: number;
  dud_events: number;
  attendance_unrecorded_events: number;
  created_events: number;
  draft_events: number;
  published_events: number;
  scheduling_events: number;
  scheduling_used: number;
  scheduling_confirmed: number;
  feature_events: number;
  chat_used: number;
  survey_used: number;
  checkin_used: number;
  venue_wanted_events: number;
  venue_wanted_filled: number;
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
}

interface UserAgg {
  signups: number;
  activated_participant: number;
  activated_host: number;
  active_users: number;
}

interface HealthAgg {
  delete_requested: number;
  delete_completed: number;
  restored: number;
  pending_deletion: number;
}

interface MatchingAgg {
  venue_offers: number;
  venue_accepted: number;
  venue_declined: number;
  venue_pending: number;
  eggs: number;
  egg_attend: number;
  egg_host: number;
  eggs_converted: number;
}

export const kpiRepo = {
  /** 運営ダッシュボードの全指標をまとめて取得（sinceDay は '0000' で全期間）。
   * Workers のサブリクエスト上限を意識し、1指標1クエリにせず 10 本にまとめている。 */
  async overview(sinceDay: string, days: number | null): Promise<KpiPayload> {
    const now = Date.now();

    // --- (1) イベント: 北極星・主催者ファネル・機能利用率・会場募集の充足 ---
    // 期間の当て方が指標ごとに違う（開催日基準 / 作成日基準）ため、
    // WHERE では絞らず CASE の中で条件を切り替えて1クエリにまとめる。
    const eventAgg = await one<EventAgg>(
      `WITH base AS (
         SELECT e.id AS id, e.status AS status, e.scheduling AS scheduling,
                e.attendance_check AS attendance_check, e.chat_channel_id AS chat_channel_id,
                e.venue_wanted AS venue_wanted,
                (${jd("e.created_at")} >= ?) AS in_created,
                ${HELD("e")} AS held
         FROM event e
       ),
       ev AS (
         -- 相関サブクエリは開催済みイベントでだけ評価する（下書き・未来のイベントで
         -- 数えても捨てるだけなので CASE で短絡させる）
         SELECT b.*,
                CASE WHEN b.held THEN (
                  -- イベントページの participantCount と同じ定義（主催・スタッフを含む）
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = b.id AND em.status = 'confirmed'
                     AND (b.attendance_check = 0 OR em.attended = 1 OR em.role <> 'participant')
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS pcount,
                CASE WHEN b.held THEN (
                  -- 不発判定用。主催・スタッフを含めるとチーム規模でしきい値がぶれる。
                  -- 審査員・観覧者は実際に来る人なので参加者として数える
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
         COALESCE(SUM(CASE WHEN held AND unrecorded = 1 THEN 1 ELSE 0 END), 0) AS attendance_unrecorded_events,
         COALESCE(SUM(CASE WHEN in_created THEN 1 ELSE 0 END), 0) AS created_events,
         COALESCE(SUM(CASE WHEN in_created AND status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_events,
         COALESCE(SUM(CASE WHEN in_created AND status = 'published' THEN 1 ELSE 0 END), 0) AS published_events,
         COALESCE(SUM(CASE WHEN in_created AND status = 'published' AND scheduling = 1 THEN 1 ELSE 0 END), 0) AS scheduling_events,
         COALESCE(SUM(CASE WHEN in_created AND EXISTS (SELECT 1 FROM event_date_option o WHERE o.event_id = ev.id) THEN 1 ELSE 0 END), 0) AS scheduling_used,
         COALESCE(SUM(CASE WHEN in_created AND scheduling = 0 AND EXISTS (SELECT 1 FROM event_date_option o WHERE o.event_id = ev.id) THEN 1 ELSE 0 END), 0) AS scheduling_confirmed,
         COALESCE(SUM(CASE WHEN in_created AND status = 'published' THEN 1 ELSE 0 END), 0) AS feature_events,
         COALESCE(SUM(CASE WHEN in_created AND status = 'published' AND chat_channel_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS chat_used,
         COALESCE(SUM(CASE WHEN in_created AND status = 'published' AND EXISTS (SELECT 1 FROM event_survey_question q WHERE q.event_id = ev.id) THEN 1 ELSE 0 END), 0) AS survey_used,
         COALESCE(SUM(CASE WHEN in_created AND status = 'published' AND attendance_check = 1 THEN 1 ELSE 0 END), 0) AS checkin_used,
         COALESCE(SUM(CASE WHEN in_created AND venue_wanted = 1 THEN 1 ELSE 0 END), 0) AS venue_wanted_events,
         COALESCE(SUM(CASE WHEN in_created AND venue_wanted = 1 AND EXISTS (SELECT 1 FROM venue_offer vo WHERE vo.event_id = ev.id AND vo.status = 'accepted') THEN 1 ELSE 0 END), 0) AS venue_wanted_filled
       FROM ev`,
      sinceDay,
      now,
      sinceDay,
    );

    // --- (2) 参加登録: 登録数・キャンセル・出席 ---
    // 登録/キャンセルは「登録の作成日」基準、出席は「イベントの終了日」基準。
    // 主催・スタッフの行（イベント作成時に自動で作られる）と下書きイベントは除く。
    // 除かないとイベントを1件作るたびに参加登録が+1され、キャンセル率が過小に出る。
    // 審査員・観覧者は実際にイベントに来る人なので参加登録として数える。
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
       WHERE ${JOINED("m")} AND e.status = 'published' AND ${MEMBER_USER_ACTIVE}`,
      sinceDay,
      sinceDay,
      sinceDay,
      sinceDay,
      now,
      sinceDay,
      now,
      sinceDay,
    );

    // --- (3) 閲覧（イベント詳細ページ）---
    const viewAgg = await one<ViewAgg>(
      `SELECT
         (SELECT COUNT(DISTINCT visitor_id) FROM event_view_unique WHERE day >= ?) AS unique_viewers,
         (SELECT COALESCE(SUM(views), 0) FROM event_view_stat WHERE day >= ?) AS total_views`,
      sinceDay,
      sinceDay,
    );

    // --- (4) リピート参加率・参加回数の分布 ---
    const repeatAgg = await one<RepeatAgg>(
      `WITH pc AS (
         SELECT m.user_id AS uid, COUNT(DISTINCT m.event_id) AS n
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE m.status = 'confirmed' AND ${JOINED("m")}
           AND (e.attendance_check = 0 OR m.attended = 1)
           AND ${HELD("e")}
           AND ${MEMBER_USER_ACTIVE}
         GROUP BY m.user_id
       )
       SELECT COUNT(1) AS people,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeaters,
              COALESCE(SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END), 0) AS c1,
              COALESCE(SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END), 0) AS c2,
              COALESCE(SUM(CASE WHEN n = 3 THEN 1 ELSE 0 END), 0) AS c3,
              COALESCE(SUM(CASE WHEN n BETWEEN 4 AND 5 THEN 1 ELSE 0 END), 0) AS c45,
              COALESCE(SUM(CASE WHEN n BETWEEN 6 AND 10 THEN 1 ELSE 0 END), 0) AS c610,
              COALESCE(SUM(CASE WHEN n >= 11 THEN 1 ELSE 0 END), 0) AS c11
       FROM pc`,
      now,
      sinceDay,
    );

    // --- (5) 再開催率・主催者あたり開催数 ---
    const hostAgg = await one<HostAgg>(
      `WITH hc AS (
         SELECT e.created_by AS uid, COUNT(1) AS n
         FROM event e
         WHERE ${HELD("e")}
           AND EXISTS (SELECT 1 FROM user u WHERE u.id = e.created_by AND u.deleted_at IS NULL)
         GROUP BY e.created_by
       )
       SELECT COUNT(1) AS hosts,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeat_hosts,
              COALESCE(SUM(n), 0) AS total_held
       FROM hc`,
      now,
      sinceDay,
    );

    // --- (6) 新規登録とアクティベーション ---
    // 「初回参加」は staff 以外の行だけ。イベント作成時に作成者の staff 行ができるため、
    // role を絞らないと「主催しただけの人」が全員「参加した人」に数えられる。
    const userAgg = await one<UserAgg>(
      `SELECT
         COUNT(1) AS signups,
         COALESCE(SUM(CASE WHEN EXISTS (
           SELECT 1 FROM event_member m JOIN event e ON e.id = m.event_id
           WHERE m.user_id = au.id AND m.status = 'confirmed'
             AND ${JOINED("m")} AND e.status = 'published'
         ) THEN 1 ELSE 0 END), 0) AS activated_participant,
         COALESCE(SUM(CASE WHEN EXISTS (
           SELECT 1 FROM event e WHERE e.created_by = au.id AND e.status = 'published'
         ) THEN 1 ELSE 0 END), 0) AS activated_host,
         (SELECT COUNT(1) FROM user WHERE deleted_at IS NULL) AS active_users
       FROM user au
       WHERE au.deleted_at IS NULL AND ${jd("au.created_at")} >= ?`,
      sinceDay,
    );

    // --- (7) 日次推移（新規登録 / 参加登録）---
    // 期間フィルタは各枝の WHERE に降ろす（全件を GROUP BY してから HAVING で
    // 捨てると user / event_member のフルスキャンになる）。
    // 「参加登録」の系列は確定（confirmed）の行だけを数えるので、タイルの
    // registrations（取消を含む全ステータス）とは一致しない。画面側の系列名も
    // 「確定参加登録」にして区別している。role・イベント状態の条件は揃える。
    const daily = await many<{ day: string; signups: number; joins: number }>(
      `SELECT day, SUM(signups) AS signups, SUM(joins) AS joins FROM (
         SELECT ${jd("u.created_at")} AS day, 1 AS signups, 0 AS joins
         FROM user u WHERE u.deleted_at IS NULL AND ${jd("u.created_at")} >= ?
         UNION ALL
         SELECT ${jd("m.created_at")} AS day, 0 AS signups, 1 AS joins
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE m.status = 'confirmed' AND ${JOINED("m")}
           AND e.status = 'published' AND ${jd("m.created_at")} >= ?
           AND ${MEMBER_USER_ACTIVE}
       )
       GROUP BY day ORDER BY day`,
      sinceDay,
      sinceDay,
    );

    // --- (8) 健全性: 退会・復帰 ---
    const healthAgg = await one<HealthAgg>(
      `SELECT
         COALESCE(SUM(CASE WHEN action = 'account_delete_requested' THEN 1 ELSE 0 END), 0) AS delete_requested,
         COALESCE(SUM(CASE WHEN action IN ('account_delete_completed', 'account_delete') THEN 1 ELSE 0 END), 0) AS delete_completed,
         COALESCE(SUM(CASE WHEN action = 'account_restore' THEN 1 ELSE 0 END), 0) AS restored,
         (SELECT COUNT(1) FROM user WHERE deleted_at IS NOT NULL) AS pending_deletion
       FROM audit_log WHERE ${jd("created_at")} >= ?`,
      sinceDay,
    );

    // --- (9) ログイン方法の内訳（現時点のスナップショット）---
    const providers = await many<KpiProviderCount>(
      `SELECT provider, COUNT(DISTINCT user_id) AS users
       FROM identity i
       WHERE EXISTS (SELECT 1 FROM user u WHERE u.id = i.user_id AND u.deleted_at IS NULL)
       GROUP BY provider ORDER BY users DESC`,
    );

    // --- (10) マッチング（会場オファー / たまご）---
    // たまごは「投稿されたコンテンツの量」なので、公開たまご一覧・賛同数の表示と
    // 同じ数え方にする（一覧側は投稿者・賛同者の退会申請中を除いていない）。
    // 退会申請中を除くのは成長・定着系の「人数」指標だけに留める。
    const matchingAgg = await one<MatchingAgg>(
      `SELECT
         (SELECT COUNT(1) FROM venue_offer WHERE ${jd("created_at")} >= ?) AS venue_offers,
         (SELECT COUNT(1) FROM venue_offer WHERE ${jd("created_at")} >= ? AND status = 'accepted') AS venue_accepted,
         (SELECT COUNT(1) FROM venue_offer WHERE ${jd("created_at")} >= ? AND status = 'declined') AS venue_declined,
         (SELECT COUNT(1) FROM venue_offer WHERE ${jd("created_at")} >= ? AND status = 'pending') AS venue_pending,
         (SELECT COUNT(1) FROM event_request r WHERE ${jd("r.created_at")} >= ?) AS eggs,
         (SELECT COUNT(1) FROM event_request_reaction x JOIN event_request r ON r.id = x.request_id
           WHERE ${jd("r.created_at")} >= ? AND x.kind = 'attend') AS egg_attend,
         (SELECT COUNT(1) FROM event_request_reaction x JOIN event_request r ON r.id = x.request_id
           WHERE ${jd("r.created_at")} >= ? AND x.kind = 'host') AS egg_host,
         (SELECT COUNT(1) FROM event_request r WHERE ${jd("r.created_at")} >= ?
           AND EXISTS (SELECT 1 FROM event_request_event re WHERE re.request_id = r.id)) AS eggs_converted`,
      sinceDay,
      sinceDay,
      sinceDay,
      sinceDay,
      sinceDay,
      sinceDay,
      sinceDay,
      sinceDay,
    );

    return buildPayload({
      days,
      sinceDay,
      eventAgg,
      memberAgg,
      viewAgg,
      repeatAgg,
      hostAgg,
      userAgg,
      daily,
      healthAgg,
      providers,
      matchingAgg,
    });
  },
};

function buildPayload(src: {
  days: number | null;
  sinceDay: string;
  eventAgg: EventAgg | null;
  memberAgg: MemberAgg | null;
  viewAgg: ViewAgg | null;
  repeatAgg: RepeatAgg | null;
  hostAgg: HostAgg | null;
  userAgg: UserAgg | null;
  daily: { day: string; signups: number; joins: number }[];
  healthAgg: HealthAgg | null;
  providers: KpiProviderCount[];
  matchingAgg: MatchingAgg | null;
}): KpiPayload {
  const heldEvents = N(src.eventAgg?.held_events);
  const participations = N(src.eventAgg?.held_participations);
  const heldParticipants = N(src.eventAgg?.held_participants);
  const dudEvents = N(src.eventAgg?.dud_events);
  // 出席チェックを有効にしたのに記録が0件のイベントは「不発」ではなく「未記録」。
  // 参加者数が構造的に0になるため、分子・分母の両方から外す
  const attendanceUnrecordedEvents = N(src.eventAgg?.attendance_unrecorded_events);
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
  const countDistribution: KpiDistributionBucket[] = [
    { label: "1回", users: N(src.repeatAgg?.c1) },
    { label: "2回", users: N(src.repeatAgg?.c2) },
    { label: "3回", users: N(src.repeatAgg?.c3) },
    { label: "4〜5回", users: N(src.repeatAgg?.c45) },
    { label: "6〜10回", users: N(src.repeatAgg?.c610) },
    { label: "11回以上", users: N(src.repeatAgg?.c11) },
  ];

  const hosts = N(src.hostAgg?.hosts);
  const schedulingUsed = N(src.eventAgg?.scheduling_used);
  const featureEvents = N(src.eventAgg?.feature_events);
  const chatUsed = N(src.eventAgg?.chat_used);
  const surveyUsed = N(src.eventAgg?.survey_used);
  const checkinUsed = N(src.eventAgg?.checkin_used);

  const signups = N(src.userAgg?.signups);
  const activatedParticipant = N(src.userAgg?.activated_participant);
  const activatedHost = N(src.userAgg?.activated_host);

  const venueOffers = N(src.matchingAgg?.venue_offers);
  const venueWantedEvents = N(src.eventAgg?.venue_wanted_events);
  const venueWantedFilled = N(src.eventAgg?.venue_wanted_filled);
  const eggs = N(src.matchingAgg?.eggs);
  const eggAttend = N(src.matchingAgg?.egg_attend);
  const eggHost = N(src.matchingAgg?.egg_host);

  const dailyPoints: KpiDailyPoint[] = src.daily.map((d) => ({
    day: d.day,
    signups: d.signups,
    joins: d.joins,
  }));

  return {
    days: src.days,
    sinceDay: src.sinceDay,
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
      repeatRate: rate(repeaters, people),
      countDistribution,
    },
    organizers: {
      createdEvents: N(src.eventAgg?.created_events),
      draftEvents: N(src.eventAgg?.draft_events),
      publishedEvents: N(src.eventAgg?.published_events),
      schedulingEvents: N(src.eventAgg?.scheduling_events),
      schedulingUsedEvents: schedulingUsed,
      schedulingConfirmedEvents: N(src.eventAgg?.scheduling_confirmed),
      schedulingConfirmRate: rate(
        N(src.eventAgg?.scheduling_confirmed),
        schedulingUsed,
      ),
      heldEvents,
      dudEvents,
      attendanceUnrecordedEvents,
      dudBaseEvents,
      dudRate: rate(dudEvents, dudBaseEvents),
      hosts,
      heldEventsWithActiveHost: N(src.hostAgg?.total_held),
      repeatHosts: N(src.hostAgg?.repeat_hosts),
      repeatHostRate: rate(N(src.hostAgg?.repeat_hosts), hosts),
      avgEventsPerHost: rate(N(src.hostAgg?.total_held), hosts),
    },
    retention: {
      signups,
      activatedParticipant,
      activatedHost,
      activationParticipantRate: rate(activatedParticipant, signups),
      activationHostRate: rate(activatedHost, signups),
      activeUsers: N(src.userAgg?.active_users),
      daily: dailyPoints,
    },
    health: {
      deleteRequested: N(src.healthAgg?.delete_requested),
      deleteCompleted: N(src.healthAgg?.delete_completed),
      restored: N(src.healthAgg?.restored),
      pendingDeletion: N(src.healthAgg?.pending_deletion),
      providers: src.providers,
      featureEvents,
      chatUsedEvents: chatUsed,
      chatUsedRate: rate(chatUsed, featureEvents),
      surveyUsedEvents: surveyUsed,
      surveyUsedRate: rate(surveyUsed, featureEvents),
      checkinUsedEvents: checkinUsed,
      checkinUsedRate: rate(checkinUsed, featureEvents),
    },
    matching: {
      venueOffers,
      venueOffersAccepted: N(src.matchingAgg?.venue_accepted),
      venueOffersDeclined: N(src.matchingAgg?.venue_declined),
      venueOffersPending: N(src.matchingAgg?.venue_pending),
      venueOfferAcceptRate: rate(N(src.matchingAgg?.venue_accepted), venueOffers),
      venueWantedEvents,
      venueWantedFilled,
      venueWantedFillRate: rate(venueWantedFilled, venueWantedEvents),
      eggs,
      eggAttendReactions: eggAttend,
      eggHostReactions: eggHost,
      eggsConverted: N(src.matchingAgg?.eggs_converted),
      eggConversionRate: rate(N(src.matchingAgg?.eggs_converted), eggs),
      avgReactionsPerEgg: rate(eggAttend + eggHost, eggs),
    },
  };
}
