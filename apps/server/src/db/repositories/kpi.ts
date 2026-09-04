import {
  KPI_DAILY_MAX_DAYS,
  type KpiPayload,
  type KpiPreviousValues,
  type KpiProviderCount,
} from "@eventer/shared";
import { many, one } from "../client.js";
import {
  type AggPick,
  COUNT_BUCKET_COLUMNS,
  type CountBucketRow,
  DAILY_HELD_EVENTS,
  DAILY_PARTICIPATIONS,
  DAY_PERIOD,
  type Dual,
  HELD_EVENT_COUNTS,
  HELD_METRIC_COLUMNS,
  HELD_PERIOD,
  type HeldEventAgg,
  type HostAgg,
  HOST_COUNT_COLUMNS,
  JOINED,
  MEMBER_USER_ACTIVE,
  N,
  REGISTRATION_COLUMNS,
  REGISTRATION_SOURCE,
  REPEAT_PEOPLE_COLUMNS,
  type RegistrationAgg,
  type RepeatAgg,
  type ViewAgg,
  countDistribution,
  dual,
  jd,
  picker,
  rate,
  sharedMetrics,
} from "./kpiMetrics.js";
import {
  type ActiveRow,
  type DailyRow,
  fillDailySeries,
  jstDay,
} from "./kpiSeries.js";

/** 開催の5指標 (HeldEventAgg) に、運営ダッシュボードだけが出す
 * 主催者ファネル・機能利用率・会場募集を足したもの */
interface EventAgg extends HeldEventAgg {
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

/** 参加回数の分布は今期間ぶんだけ（前期間の分布は画面に出さない） */
interface RepeatRow extends Dual<RepeatAgg>, CountBucketRow {}

interface UserAgg {
  signups: number;
  activated_participant: number;
  activated_host: number;
}

interface HealthAgg {
  delete_requested: number;
  delete_completed: number;
  restored: number;
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

/** 期間で切らない現在値（スナップショット）は前期間を持たないので、dual() を通さず
 * 同じクエリに1列だけ足す（そのためだけにクエリを1本増やさない） */
interface UserRow extends Dual<UserAgg> {
  active_users: number;
}

interface HealthRow extends Dual<HealthAgg> {
  pending_deletion: number;
}

export const kpiRepo = {
  /** 運営ダッシュボードの全指標をまとめて取得（sinceDay は '0000' で全期間）。
   * Workers のサブリクエスト上限を意識し、1指標1クエリにせず 11 本にまとめている。
   * 前期間 (#266) は本数を増やさず、各クエリの CASE の中で同時に数える。 */
  async overview(
    sinceDay: string,
    prevSinceDay: string,
    days: number | null,
  ): Promise<KpiPayload> {
    const now = Date.now();
    const today = jstDay(now);

    // --- (1) イベント: 北極星・主催者ファネル・機能利用率・会場募集の充足 ---
    // 期間の当て方が指標ごとに違う（開催日基準 / 作成日基準）ため、
    // WHERE では絞らず CASE の中で条件を切り替えて1クエリにまとめる。
    const eventAgg = await one<Dual<EventAgg>>(
      `WITH base AS (
         SELECT e.id AS id, e.status AS status, e.scheduling AS scheduling,
                e.attendance_check AS attendance_check, e.chat_channel_id AS chat_channel_id,
                e.venue_wanted AS venue_wanted,
                ${DAY_PERIOD(jd("e.created_at"))} AS created_p,
                ${HELD_PERIOD("e")} AS held_p
         FROM event e
       ),
       ev AS (
         SELECT b.*,
                ${HELD_EVENT_COUNTS("b")}
         FROM base b
       )
       SELECT
         ${HELD_METRIC_COLUMNS},
         ${dual("created_events", "created_p")},
         ${dual("draft_events", "created_p", "status = 'draft'")},
         ${dual("published_events", "created_p", "status = 'published'")},
         ${dual("scheduling_events", "created_p", "status = 'published' AND scheduling = 1")},
         ${dual("scheduling_used", "created_p", "EXISTS (SELECT 1 FROM event_date_option o WHERE o.event_id = ev.id)")},
         ${dual("scheduling_confirmed", "created_p", "scheduling = 0 AND EXISTS (SELECT 1 FROM event_date_option o WHERE o.event_id = ev.id)")},
         ${dual("feature_events", "created_p", "status = 'published'")},
         ${dual("chat_used", "created_p", "status = 'published' AND chat_channel_id IS NOT NULL")},
         ${dual("survey_used", "created_p", "status = 'published' AND EXISTS (SELECT 1 FROM event_survey_question q WHERE q.event_id = ev.id)")},
         ${dual("checkin_used", "created_p", "status = 'published' AND attendance_check = 1")},
         ${dual("venue_wanted_events", "created_p", "venue_wanted = 1")},
         ${dual("venue_wanted_filled", "created_p", "venue_wanted = 1 AND EXISTS (SELECT 1 FROM venue_offer vo WHERE vo.event_id = ev.id AND vo.status = 'accepted')")}
       FROM ev`,
      sinceDay,
      prevSinceDay,
      sinceDay,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
    );

    // --- (2) 参加登録: 登録数・キャンセル・出席 ---
    const memberAgg = await one<Dual<RegistrationAgg>>(
      `WITH reg AS (
         ${REGISTRATION_SOURCE()}
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
    );

    // --- (3) 閲覧（イベント詳細ページ）---
    // どちらのテーブルにも day の索引が無いので必ず全走査になる。期間ごとに
    // スカラーサブクエリを並べると同じテーブルを2回スキャンするため、
    // マッチング (11) と同じく**派生テーブルで今期間・前期間を1度に数える**。
    const viewAgg = await one<Dual<ViewAgg>>(
      `SELECT vu.unique_viewers, vu.prev_unique_viewers,
              vs.total_views, vs.prev_total_views
       FROM (SELECT COUNT(DISTINCT CASE WHEN day >= ? THEN visitor_id END)
                      AS unique_viewers,
                    COUNT(DISTINCT CASE WHEN day >= ? AND day < ? THEN visitor_id END)
                      AS prev_unique_viewers
               FROM event_view_unique WHERE day >= ?) vu,
            (SELECT COALESCE(SUM(CASE WHEN day >= ? THEN views ELSE 0 END), 0)
                      AS total_views,
                    COALESCE(SUM(CASE WHEN day >= ? AND day < ? THEN views ELSE 0 END), 0)
                      AS prev_total_views
               FROM event_view_stat WHERE day >= ?) vs`,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
    );

    // --- (4) リピート参加率・参加回数の分布 ---
    // 1人につき「今期間の参加イベント数」と「前期間の参加イベント数」を同時に数える
    const repeatAgg = await one<RepeatRow>(
      `WITH pc AS (
         SELECT uid,
                COUNT(DISTINCT CASE WHEN held_p = 1 THEN eid END) AS n,
                COUNT(DISTINCT CASE WHEN held_p = 2 THEN eid END) AS prev_n
         FROM (
           SELECT m.user_id AS uid, m.event_id AS eid, ${HELD_PERIOD("e")} AS held_p
           FROM event_member m JOIN event e ON e.id = m.event_id
           WHERE m.status = 'confirmed' AND ${JOINED("m")}
             AND (e.attendance_check = 0 OR m.attended = 1)
             AND ${MEMBER_USER_ACTIVE}
         )
         WHERE held_p > 0
         GROUP BY uid
       )
       SELECT ${REPEAT_PEOPLE_COLUMNS},
              ${COUNT_BUCKET_COLUMNS}
       FROM pc`,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
    );

    // --- (5) 再開催率・主催者あたり開催数 ---
    const hostAgg = await one<Dual<HostAgg>>(
      `WITH hc AS (
         SELECT uid,
                COUNT(CASE WHEN held_p = 1 THEN 1 END) AS n,
                COUNT(CASE WHEN held_p = 2 THEN 1 END) AS prev_n
         FROM (
           SELECT e.created_by AS uid, ${HELD_PERIOD("e")} AS held_p
           FROM event e
           WHERE EXISTS (SELECT 1 FROM user u WHERE u.id = e.created_by AND u.deleted_at IS NULL)
         )
         WHERE held_p > 0
         GROUP BY uid
       )
       SELECT ${HOST_COUNT_COLUMNS}
       FROM hc`,
      now,
      sinceDay,
      prevSinceDay,
      sinceDay,
    );

    // --- (6) 新規登録とアクティベーション ---
    // 「初回参加」は staff 以外の行だけ。イベント作成時に作成者の staff 行ができるため、
    // role を絞らないと「主催しただけの人」が全員「参加した人」に数えられる。
    // アクティベーションは「これまでに1度でも」なので期間で切らない（分母だけ期間で切る）
    const userAgg = await one<UserRow>(
      `WITH au AS (
         SELECT ${DAY_PERIOD(jd("u.created_at"))} AS p,
                EXISTS (
                  SELECT 1 FROM event_member m JOIN event e ON e.id = m.event_id
                  WHERE m.user_id = u.id AND m.status = 'confirmed'
                    AND ${JOINED("m")} AND e.status = 'published'
                ) AS act_join,
                EXISTS (
                  SELECT 1 FROM event e WHERE e.created_by = u.id AND e.status = 'published'
                ) AS act_host
         FROM user u
         WHERE u.deleted_at IS NULL AND ${jd("u.created_at")} >= ?
       )
       SELECT
         ${dual("signups", "p")},
         ${dual("activated_participant", "p", "act_join = 1")},
         ${dual("activated_host", "p", "act_host = 1")},
         (SELECT COUNT(1) FROM user WHERE deleted_at IS NULL) AS active_users
       FROM au`,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
    );

    // --- (7) 日次推移 ---
    // 期間フィルタは各枝の WHERE に降ろす（全件を GROUP BY してから HAVING で
    // 捨てると user / event_member のフルスキャンになる）。
    // 「参加登録」の系列は確定（confirmed）の行だけを数えるので、タイルの
    // registrations（取消を含む全ステータス）とは一致しない。画面側の系列名も
    // 「確定参加登録」にして区別している。role・イベント状態の条件は揃える。
    // 開催数・参加体験数は北極星タイルと同じ数え方で、開催日 (ends_at) の日に立てる。
    // D1 の SQLite は1つの複合SELECTに並べられる項数が少ないので **4枝まで**
    // （超えると "too many terms in compound SELECT"。trending.ts と同じ制約）。
    const daily = await many<DailyRow>(
      `SELECT day, SUM(signups) AS signups, SUM(joins) AS joins,
              SUM(held_events) AS held_events, SUM(participations) AS participations
       FROM (
         SELECT ${jd("u.created_at")} AS day, 1 AS signups, 0 AS joins,
                0 AS held_events, 0 AS participations
         FROM user u WHERE u.deleted_at IS NULL AND ${jd("u.created_at")} >= ?
         UNION ALL
         SELECT ${jd("m.created_at")}, 0, 1, 0, 0
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE m.status = 'confirmed' AND ${JOINED("m")}
           AND e.status = 'published' AND ${jd("m.created_at")} >= ?
           AND ${MEMBER_USER_ACTIVE}
         UNION ALL
         SELECT ${jd("e.ends_at")}, 0, 0, 1, 0
         ${DAILY_HELD_EVENTS()}
         UNION ALL
         SELECT ${jd("e.ends_at")}, 0, 0, 0, 1
         ${DAILY_PARTICIPATIONS()}
       )
       GROUP BY day ORDER BY day`,
      sinceDay,
      sinceDay,
      now,
      sinceDay,
      now,
      sinceDay,
    );

    // --- (8) DAU / MAU の推移 (#266) ---
    // user_active_day は「その日アクセスした」1ユーザー1行 (#257)。
    // MAU は各日時点の「直近30日にアクティブだったユーザーの実数」のローリング。
    // axis を再帰CTEで作るのは、活動ゼロの日にも MAU の値が要るため
    // （その日の行が無いだけで MAU が 0 に落ちたように見えてしまう）。
    // axis の開始は「指定期間の開始」と「計測開始日」の遅い方。計測より前の日を
    // 並べても 0 が続くだけで「誰も居なかった」と誤読される。
    //
    // MAU は1日あたり30日ぶんを引き当てるので、走査量が axis日数 × 30 × DAU の
    // オーダーになる（365日レンジや全期間だと1回の表示で100万行規模）。
    // **画面がまとめて出す長さのときは、期末の日ぶんだけ算出する**。
    // まとめる処理は MAU を「その期間の最終の既知値」で畳むので、間の日は使われない。
    // 期末は週次なら日曜、月次なら月末 (#292) なので、その両方を残す。
    // 画面の粒度は系列の点数 (kpiGranularity) で決まり、系列は axis 以上の長さに
    // なる（axis の開始は期間の開始以降）。つまり axis が日次でないと判断する長さなら
    // 画面も必ず週次か月次になり、間引いた日が日次表示で欠けることはない。
    const active = await many<ActiveRow>(
      `WITH RECURSIVE bounds(head, tail) AS (
         SELECT MAX(?, (SELECT COALESCE(MIN(day), ?) FROM user_active_day)), ?
       ),
       axis(day) AS (
         SELECT head FROM bounds
         UNION ALL
         SELECT date(day, '+1 day') FROM axis WHERE day < (SELECT tail FROM bounds)
       )
       SELECT x.day AS day,
              (SELECT COUNT(1) FROM user_active_day d WHERE d.day = x.day) AS dau,
              CASE WHEN (SELECT julianday(tail) - julianday(head) + 1 FROM bounds) <= ?
                        OR strftime('%w', x.day) = '0'
                        OR strftime('%d', date(x.day, '+1 day')) = '01'
                   THEN (SELECT COUNT(DISTINCT a.user_id) FROM user_active_day a
                          WHERE a.day <= x.day AND a.day >= date(x.day, '-29 days'))
              END AS mau,
              (SELECT MIN(day) FROM user_active_day) AS measured_from
       FROM axis x ORDER BY x.day`,
      sinceDay,
      today,
      today,
      KPI_DAILY_MAX_DAYS,
    );

    // --- (9) 健全性: 退会・復帰 ---
    const healthAgg = await one<HealthRow>(
      `WITH a AS (
         SELECT ${DAY_PERIOD(jd("created_at"))} AS p, action
         FROM audit_log WHERE ${jd("created_at")} >= ?
       )
       SELECT
         ${dual("delete_requested", "p", "action = 'account_delete_requested'")},
         ${dual("delete_completed", "p", "action IN ('account_delete_completed', 'account_delete')")},
         ${dual("restored", "p", "action = 'account_restore'")},
         (SELECT COUNT(1) FROM user WHERE deleted_at IS NOT NULL) AS pending_deletion
       FROM a`,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
    );

    // --- (10) ログイン方法の内訳（現時点のスナップショット）---
    const providers = await many<KpiProviderCount>(
      `SELECT provider, COUNT(DISTINCT user_id) AS users
       FROM identity i
       WHERE EXISTS (SELECT 1 FROM user u WHERE u.id = i.user_id AND u.deleted_at IS NULL)
       GROUP BY provider ORDER BY users DESC`,
    );

    // --- (11) マッチング（会場オファー / たまご）---
    // たまごは「投稿されたコンテンツの量」なので、公開たまご一覧・賛同数の表示と
    // 同じ数え方にする（一覧側は投稿者・賛同者の退会申請中を除いていない）。
    // 退会申請中を除くのは成長・定着系の「人数」指標だけに留める。
    // 粒度が違う3つ（オファー / たまご / 賛同）を1行ずつに畳んでから横に並べる。
    const matchingAgg = await one<Dual<MatchingAgg>>(
      `WITH vo AS (
         SELECT ${dual("venue_offers", "p")},
                ${dual("venue_accepted", "p", "status = 'accepted'")},
                ${dual("venue_declined", "p", "status = 'declined'")},
                ${dual("venue_pending", "p", "status = 'pending'")}
         FROM (SELECT ${DAY_PERIOD(jd("created_at"))} AS p, status
                 FROM venue_offer WHERE ${jd("created_at")} >= ?)
       ),
       eg AS (
         SELECT ${dual("eggs", "p")},
                ${dual("eggs_converted", "p", "converted = 1")}
         FROM (SELECT ${DAY_PERIOD(jd("r.created_at"))} AS p,
                      EXISTS (SELECT 1 FROM event_request_event re WHERE re.request_id = r.id) AS converted
                 FROM event_request r WHERE ${jd("r.created_at")} >= ?)
       ),
       rx AS (
         SELECT ${dual("egg_attend", "p", "kind = 'attend'")},
                ${dual("egg_host", "p", "kind = 'host'")}
         FROM (SELECT ${DAY_PERIOD(jd("r.created_at"))} AS p, x.kind AS kind
                 FROM event_request_reaction x JOIN event_request r ON r.id = x.request_id
                WHERE ${jd("r.created_at")} >= ?)
       )
       SELECT vo.*, eg.*, rx.* FROM vo, eg, rx`,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
      sinceDay,
      prevSinceDay,
    );

    return buildPayload({
      days,
      sinceDay,
      prevSinceDay,
      today,
      eventAgg,
      memberAgg,
      viewAgg,
      repeatAgg,
      hostAgg,
      userAgg,
      daily,
      active,
      healthAgg,
      providers,
      matchingAgg,
    });
  },
};

/** 1つの期間ぶんの指標。今期間・前期間の両方でこの関数を通すので、
 * 片方だけ数え方がずれることがない。
 * 両方の画面に出るタイルは sharedMetrics()（＝コミュニティKPIと同じ式）。
 * 全体KPIは母数ゲートを掛けないので rate をそのまま渡す */
function periodMetrics(s: {
  event: AggPick<EventAgg>;
  member: AggPick<RegistrationAgg>;
  view: AggPick<ViewAgg>;
  repeat: AggPick<RepeatAgg>;
  host: AggPick<HostAgg>;
  user: AggPick<UserAgg>;
  health: AggPick<HealthAgg>;
  matching: AggPick<MatchingAgg>;
}) {
  const shared = sharedMetrics(s, rate);

  const signups = s.user("signups");
  const activatedParticipant = s.user("activated_participant");
  const activatedHost = s.user("activated_host");

  const schedulingUsed = s.event("scheduling_used");
  const schedulingConfirmed = s.event("scheduling_confirmed");
  const featureEvents = s.event("feature_events");
  const chatUsed = s.event("chat_used");
  const surveyUsed = s.event("survey_used");
  const checkinUsed = s.event("checkin_used");

  const venueOffers = s.matching("venue_offers");
  const venueAccepted = s.matching("venue_accepted");
  const venueWantedEvents = s.event("venue_wanted_events");
  const venueWantedFilled = s.event("venue_wanted_filled");
  const eggs = s.matching("eggs");
  const eggAttend = s.matching("egg_attend");
  const eggHost = s.matching("egg_host");
  const eggsConverted = s.matching("eggs_converted");

  return {
    ...shared,

    createdEvents: s.event("created_events"),
    draftEvents: s.event("draft_events"),
    publishedEvents: s.event("published_events"),
    schedulingEvents: s.event("scheduling_events"),
    schedulingUsedEvents: schedulingUsed,
    schedulingConfirmedEvents: schedulingConfirmed,
    schedulingConfirmRate: rate(schedulingConfirmed, schedulingUsed),

    signups,
    activatedParticipant,
    activatedHost,
    activationParticipantRate: rate(activatedParticipant, signups),
    activationHostRate: rate(activatedHost, signups),

    deleteRequested: s.health("delete_requested"),
    deleteCompleted: s.health("delete_completed"),
    restored: s.health("restored"),
    featureEvents,
    chatUsedEvents: chatUsed,
    chatUsedRate: rate(chatUsed, featureEvents),
    surveyUsedEvents: surveyUsed,
    surveyUsedRate: rate(surveyUsed, featureEvents),
    checkinUsedEvents: checkinUsed,
    checkinUsedRate: rate(checkinUsed, featureEvents),

    venueOffers,
    venueOffersAccepted: venueAccepted,
    venueOffersDeclined: s.matching("venue_declined"),
    venueOffersPending: s.matching("venue_pending"),
    venueOfferAcceptRate: rate(venueAccepted, venueOffers),
    venueWantedEvents,
    venueWantedFilled,
    venueWantedFillRate: rate(venueWantedFilled, venueWantedEvents),
    eggs,
    eggAttendReactions: eggAttend,
    eggHostReactions: eggHost,
    eggsConverted,
    eggConversionRate: rate(eggsConverted, eggs),
    avgReactionsPerEgg: rate(eggAttend + eggHost, eggs),
  };
}

type PeriodMetrics = ReturnType<typeof periodMetrics>;

/** 画面のタイルに前期間比を出す指標だけを取り出す。
 * キーは @eventer/shared の KPI_METRICS（方向の定義）と1対1 */
export function previousValues(m: PeriodMetrics): KpiPreviousValues {
  return {
    participations: m.participations,
    heldEvents: m.heldEvents,
    avgParticipantsPerEvent: m.avgParticipantsPerEvent,
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
    createdEvents: m.createdEvents,
    draftEvents: m.draftEvents,
    publishedEvents: m.publishedEvents,
    schedulingEvents: m.schedulingEvents,
    schedulingConfirmRate: m.schedulingConfirmRate,
    dudRate: m.dudRate,
    hosts: m.hosts,
    repeatHostRate: m.repeatHostRate,
    avgEventsPerHost: m.avgEventsPerHost,
    signups: m.signups,
    // アクティベーション率（activationParticipantRate / activationHostRate）は
    // **意図的に外している**。分子の EXISTS が「これまでに1度でも参加/主催したか」で
    // 期間の縛りが無いため、前期間に登録した人は今期間ぶんだけ猶予が長い。
    // 横ばいのデータでも前期間の方が高く出て恒常的に「悪化」に寄り、
    // 「アクティベーションが落ちた」と誤読させる。比べるなら「登録から N 日以内」を
    // 揃えたコホート指標に定義し直す必要があり、それは #266 の範囲を超える。
    deleteRequested: m.deleteRequested,
    deleteCompleted: m.deleteCompleted,
    restored: m.restored,
    chatUsedRate: m.chatUsedRate,
    surveyUsedRate: m.surveyUsedRate,
    checkinUsedRate: m.checkinUsedRate,
    venueOffers: m.venueOffers,
    venueOfferAcceptRate: m.venueOfferAcceptRate,
    venueWantedFillRate: m.venueWantedFillRate,
    eggs: m.eggs,
    eggReactions: m.eggAttendReactions + m.eggHostReactions,
    eggConversionRate: m.eggConversionRate,
    avgReactionsPerEgg: m.avgReactionsPerEgg,
  };
}

function buildPayload(src: {
  days: number | null;
  sinceDay: string;
  prevSinceDay: string;
  today: string;
  eventAgg: Dual<EventAgg> | null;
  memberAgg: Dual<RegistrationAgg> | null;
  viewAgg: Dual<ViewAgg> | null;
  repeatAgg: RepeatRow | null;
  hostAgg: Dual<HostAgg> | null;
  userAgg: UserRow | null;
  daily: DailyRow[];
  active: ActiveRow[];
  healthAgg: HealthRow | null;
  providers: KpiProviderCount[];
  matchingAgg: Dual<MatchingAgg> | null;
}): KpiPayload {
  const sources = (prefix: "" | "prev_") => ({
    event: picker<EventAgg>(src.eventAgg, prefix),
    member: picker<RegistrationAgg>(src.memberAgg, prefix),
    view: picker<ViewAgg>(src.viewAgg, prefix),
    repeat: picker<RepeatAgg>(src.repeatAgg, prefix),
    host: picker<HostAgg>(src.hostAgg, prefix),
    user: picker<UserAgg>(src.userAgg, prefix),
    health: picker<HealthAgg>(src.healthAgg, prefix),
    matching: picker<MatchingAgg>(src.matchingAgg, prefix),
  });
  const m = periodMetrics(sources(""));
  // 全期間は比べる過去が無い（前期間の集計は必ず 0 件になるので出さない）
  const previous =
    src.days === null ? null : previousValues(periodMetrics(sources("prev_")));

  return {
    days: src.days,
    sinceDay: src.sinceDay,
    previous,
    previousSinceDay: src.days === null ? null : src.prevSinceDay,
    activeMeasuredFrom: src.active[0]?.measured_from ?? null,
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
      createdEvents: m.createdEvents,
      draftEvents: m.draftEvents,
      publishedEvents: m.publishedEvents,
      schedulingEvents: m.schedulingEvents,
      schedulingUsedEvents: m.schedulingUsedEvents,
      schedulingConfirmedEvents: m.schedulingConfirmedEvents,
      schedulingConfirmRate: m.schedulingConfirmRate,
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
    },
    retention: {
      signups: m.signups,
      activatedParticipant: m.activatedParticipant,
      activatedHost: m.activatedHost,
      activationParticipantRate: m.activationParticipantRate,
      activationHostRate: m.activationHostRate,
      activeUsers: N(src.userAgg?.active_users),
      daily: fillDailySeries(src.sinceDay, src.today, src.daily, src.active),
    },
    health: {
      deleteRequested: m.deleteRequested,
      deleteCompleted: m.deleteCompleted,
      restored: m.restored,
      pendingDeletion: N(src.healthAgg?.pending_deletion),
      providers: src.providers,
      featureEvents: m.featureEvents,
      chatUsedEvents: m.chatUsedEvents,
      chatUsedRate: m.chatUsedRate,
      surveyUsedEvents: m.surveyUsedEvents,
      surveyUsedRate: m.surveyUsedRate,
      checkinUsedEvents: m.checkinUsedEvents,
      checkinUsedRate: m.checkinUsedRate,
    },
    matching: {
      venueOffers: m.venueOffers,
      venueOffersAccepted: m.venueOffersAccepted,
      venueOffersDeclined: m.venueOffersDeclined,
      venueOffersPending: m.venueOffersPending,
      venueOfferAcceptRate: m.venueOfferAcceptRate,
      venueWantedEvents: m.venueWantedEvents,
      venueWantedFilled: m.venueWantedFilled,
      venueWantedFillRate: m.venueWantedFillRate,
      eggs: m.eggs,
      eggAttendReactions: m.eggAttendReactions,
      eggHostReactions: m.eggHostReactions,
      eggsConverted: m.eggsConverted,
      eggConversionRate: m.eggConversionRate,
      avgReactionsPerEgg: m.avgReactionsPerEgg,
    },
  };
}
