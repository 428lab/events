import type { KpiDistributionBucket } from "@eventer/shared";

/**
 * KPI の**数え方そのもの**を置く場所。
 *
 * 運営ダッシュボード (kpi.ts) とコミュニティ運営者向け (communityKpi.ts) は
 * 同じ指標を別のクエリで出す。定義を各ファイルに写すと、片方だけ直った状態が
 * 必ず生まれ、しかも両方とも緑のまま食い違う（「参加体験数」が画面によって
 * 違う数を指す）。**指標の意味を決めている式は、SQL も TypeScript もここに1つだけ置く。**
 *
 * ここに置かないもの:
 * - 閲覧（イベント詳細ページ）の集計。全体KPIは event_view_unique を単独で読み、
 *   コミュニティKPIは event を join して community_id で絞る。join の有無と
 *   WHERE の両方を引数にすると、呼び出し側から「何を走査するのか」が見えなくなる。
 *   指標の意味（UU と表示回数）はテーブルの定義そのものなので、写しても
 *   食い違いようがない。**意図的に2か所のままにしてある。**
 * - クエリの骨格（CTE の並び・GROUP BY）。断片にすると呼び出し側で
 *   D1 に何が飛ぶのか読めなくなるので、生の SQL のまま各ファイルに残す。
 */

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

/** 期間フラグ (#266)。1=今期間 [sinceDay, ) / 2=前期間 [prevSinceDay, sinceDay) / 0=対象外。
 * 「注目」(#259, trending.ts) の period() と同じ考え方だが、KPI は日次推移と
 * 期間の切り方を揃えるため **JST の日付文字列**で比べる。
 *
 * 全期間（sinceDay='0000'）のときは prevSinceDay も '0000' を渡す。すべての行が
 * 1本目の CASE に吸われ、前期間は必ず 0 件になる（画面も前期間比を出さない）。
 *
 * バインド順: sinceDay, prevSinceDay, sinceDay */
export const DAY_PERIOD = (expr: string) =>
  `CASE WHEN ${expr} >= ? THEN 1 WHEN ${expr} >= ? AND ${expr} < ? THEN 2 ELSE 0 END`;

/** HELD の期間フラグ版。開催日 (ends_at) で今期間/前期間に振り分ける。
 * バインド順: now, sinceDay, prevSinceDay, sinceDay */
export const HELD_PERIOD = (t: string) =>
  `CASE WHEN ${t}.status = 'published' AND ${t}.scheduling = 0
             AND ${t}.ends_at > 0 AND ${t}.ends_at < ?
        THEN ${DAY_PERIOD(jd(`${t}.ends_at`))} ELSE 0 END`;

/** 今期間と前期間の2列をまとめて生成する (#266)。
 * 期間ごとにクエリを分けると本数が倍になるので、1回のスキャンで両方数える。
 * @param p 期間フラグの列（1=今期間 / 2=前期間）
 * @param cond 期間以外の条件（省略可）
 * @param val 数える値（省略時は 1 = 件数） */
export const dual = (
  name: string,
  p: string,
  cond?: string,
  val = "1",
): string => {
  const c = cond ? ` AND (${cond})` : "";
  return `COALESCE(SUM(CASE WHEN ${p} = 1${c} THEN ${val} ELSE 0 END), 0) AS ${name},
         COALESCE(SUM(CASE WHEN ${p} = 2${c} THEN ${val} ELSE 0 END), 0) AS prev_${name}`;
};

/** dual() で生えた prev_* 列を含む行の型 */
export type Dual<T> = T & {
  [K in keyof T & string as `prev_${K}`]: number;
};

export const N = (v: number | null | undefined): number => v ?? 0;

/** 今期間 / 前期間のどちらを読むかを切り替えるアクセサ。
 * 同じ計算式を2回書かないための入口で、これがあるおかげで
 * 「今期間だけ数え方を直して前期間が古いまま」が起きない */
export type AggPick<T> = <K extends keyof T & string>(key: K) => number;

export const picker =
  <T,>(row: Dual<T> | null, prefix: "" | "prev_"): AggPick<T> =>
  (key) =>
    N((row as Record<string, number | null> | null)?.[`${prefix}${key}`]);

/* ---------------- 開催済みイベントの人数（両方の (1)）---------------- */

/** 開催済みイベント1件あたりの人数。派生表 (base) に pcount / ppl / unrecorded の
 * 3列を足す。相関サブクエリは開催済みイベントでだけ評価する（下書き・未来の
 * イベントで数えても捨てるだけなので CASE で短絡させる）。
 * @param b held_p / id / attendance_check を持つ派生表の別名
 * バインド不要（期間の ? は held_p 側で消費済み） */
export const HELD_EVENT_COUNTS = (b: string) =>
  `CASE WHEN ${b}.held_p > 0 THEN (
                  -- 実際に集まった人数（主催・スタッフを含む）。イベントページの
                  -- participantCount は確定メンバー数なので、ここは意図的に別定義 (#297)
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = ${b}.id AND em.status = 'confirmed'
                     AND (${b}.attendance_check = 0 OR em.attended = 1 OR em.role <> 'participant')
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS pcount,
                CASE WHEN ${b}.held_p > 0 THEN (
                  -- 不発判定用。主催・スタッフを含めるとチーム規模でしきい値がぶれる。
                  -- 審査員・観覧者は実際に来る人なので参加者として数える
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = ${b}.id AND em.status = 'confirmed'
                     AND ${JOINED("em")}
                     AND (${b}.attendance_check = 0 OR em.attended = 1)
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS ppl,
                CASE WHEN ${b}.held_p > 0 AND ${b}.attendance_check = 1
                       AND ${ATTENDANCE_UNRECORDED(`${b}.id`)}
                     THEN 1 ELSE 0 END AS unrecorded`;

/** HELD_EVENT_COUNTS を足した派生表 (ev) から数える開催の5指標。
 * 不発のしきい値（参加者3人以下）はここが唯一の定義。
 * バインド不要（held_p 側で消費済み） */
export const HELD_METRIC_COLUMNS = `${dual("held_events", "held_p")},
         ${dual("held_participations", "held_p", undefined, "pcount")},
         ${dual("held_participants", "held_p", undefined, "ppl")},
         ${dual("dud_events", "held_p", "unrecorded = 0 AND ppl <= 3")},
         ${dual("attendance_unrecorded_events", "held_p", "unrecorded = 1")}`;

/* ---------------- 参加登録（両方の (2)）---------------- */

/** 参加登録の元になる行。登録/キャンセルは「登録の作成日」基準、出席は
 * 「イベントの終了日」基準なので期間フラグを2本立てる。主催・スタッフの行
 * （イベント作成時に自動で作られる）と下書きイベントは除く。除かないと
 * イベントを1件作るたびに参加登録が+1され、キャンセル率が過小に出る。
 * 審査員・観覧者は参加登録として数える。
 * @param and 追加の絞り込み（コミュニティKPIは community_id）
 * バインド順: (DAY_PERIOD の) sinceDay, prevSinceDay, sinceDay
 *   → (HELD_PERIOD の) now, sinceDay, prevSinceDay, sinceDay
 *   → and に ? があればそのあと */
export const REGISTRATION_SOURCE = (and?: string) =>
  `SELECT ${DAY_PERIOD(jd("m.created_at"))} AS reg_p,
                ${HELD_PERIOD("e")} AS held_p,
                m.status AS status, m.attended AS attended,
                m.canceled_scheduling AS canceled_scheduling,
                m.canceled_at AS canceled_at,
                e.scheduling AS e_scheduling, e.starts_at AS e_starts_at,
                e.attendance_check AS e_attendance_check
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE ${JOINED("m")} AND e.status = 'published' AND ${MEMBER_USER_ACTIVE}${
           and ? `\n           AND ${and}` : ""
         }`;

/** REGISTRATION_SOURCE から数える登録・キャンセル・出席の6指標。
 * 「直前キャンセル」は開始24時間前より後の取消（日程調整中の取消は除く）。
 * バインド不要 */
export const REGISTRATION_COLUMNS = `${dual("registrations", "reg_p")},
         ${dual("confirmed_registrations", "reg_p", "status = 'confirmed'")},
         ${dual("canceled", "reg_p", "status = 'canceled' AND canceled_scheduling = 0")},
         ${dual("canceled_late", "reg_p", "status = 'canceled' AND canceled_scheduling = 0 AND e_scheduling = 0 AND canceled_at >= e_starts_at - 86400000")},
         ${dual("attendance_expected", "held_p", "e_attendance_check = 1 AND status = 'confirmed'")},
         ${dual("attended", "held_p", "e_attendance_check = 1 AND status = 'confirmed' AND attended = 1")}`;

/* ---------------- リピートと主催（両方の (4)(5)）---------------- */

/** 期間内に参加した実人数と、2回以上参加した人数。
 * n / prev_n は「その期間に参加した開催の件数」（呼び出し側の派生表が作る）。
 * バインド不要 */
export const REPEAT_PEOPLE_COLUMNS = `COALESCE(SUM(CASE WHEN n >= 1 THEN 1 ELSE 0 END), 0) AS people,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN 1 ELSE 0 END), 0) AS prev_people,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeaters,
              COALESCE(SUM(CASE WHEN prev_n >= 2 THEN 1 ELSE 0 END), 0) AS prev_repeaters`;

/** 参加回数の分布（今期間ぶんだけ）。区切りは countDistribution() のラベルと対。
 * 片方だけ動かすと「4〜5回」の欄に3回の人が入るので、必ず一緒に直す。
 * バインド不要 */
export const COUNT_BUCKET_COLUMNS = `COALESCE(SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END), 0) AS c1,
              COALESCE(SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END), 0) AS c2,
              COALESCE(SUM(CASE WHEN n = 3 THEN 1 ELSE 0 END), 0) AS c3,
              COALESCE(SUM(CASE WHEN n BETWEEN 4 AND 5 THEN 1 ELSE 0 END), 0) AS c45,
              COALESCE(SUM(CASE WHEN n BETWEEN 6 AND 10 THEN 1 ELSE 0 END), 0) AS c610,
              COALESCE(SUM(CASE WHEN n >= 11 THEN 1 ELSE 0 END), 0) AS c11`;

/** 開催した人数・2回以上開催した人数・開催件数の合計。
 * n / prev_n は「その期間に開催した件数」（呼び出し側の派生表が作る）。
 * バインド不要 */
export const HOST_COUNT_COLUMNS = `COALESCE(SUM(CASE WHEN n >= 1 THEN 1 ELSE 0 END), 0) AS hosts,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN 1 ELSE 0 END), 0) AS prev_hosts,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeat_hosts,
              COALESCE(SUM(CASE WHEN prev_n >= 2 THEN 1 ELSE 0 END), 0) AS prev_repeat_hosts,
              COALESCE(SUM(n), 0) AS total_held,
              COALESCE(SUM(prev_n), 0) AS prev_total_held`;

/* ---------------- 日次推移の枝（(7) 全体 / (8) コミュニティ）---------------- */

/** 日次推移「開催数」の枝。開催日 (ends_at) の日に1件立てる。
 * SELECT の列並びは呼び出し側で違う（全体KPIは4系列・コミュニティは2系列）ので、
 * ここは FROM 以降だけを持つ。
 * @param and 追加の絞り込み（コミュニティKPIは community_id）
 * バインド順: (HELD の) now, sinceDay → and に ? があればそのあと */
export const DAILY_HELD_EVENTS = (and = "") =>
  `FROM event e WHERE ${HELD("e")}${and}`;

/** 日次推移「参加体験数」の枝。北極星タイル (pcount) と同じ数え方で、
 * 開催日 (ends_at) の日に立てる。
 * @param and 追加の絞り込み（コミュニティKPIは community_id）
 * バインド順: (HELD の) now, sinceDay → and に ? があればそのあと */
export const DAILY_PARTICIPATIONS = (and = "") =>
  `FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE m.status = 'confirmed'
           AND (e.attendance_check = 0 OR m.attended = 1 OR m.role <> 'participant')
           AND ${MEMBER_USER_ACTIVE} AND ${HELD("e")}${and}`;

/* ---------------- 行の型（SQL の列名と1対1）---------------- */

/** HELD_METRIC_COLUMNS が返す列 */
export interface HeldEventAgg {
  held_events: number;
  held_participations: number;
  held_participants: number;
  dud_events: number;
  attendance_unrecorded_events: number;
}

/** REGISTRATION_COLUMNS が返す列 */
export interface RegistrationAgg {
  registrations: number;
  confirmed_registrations: number;
  canceled: number;
  canceled_late: number;
  attendance_expected: number;
  attended: number;
}

/** 閲覧の集計（クエリ自体は各ファイルに残す。上の注記を参照） */
export interface ViewAgg {
  unique_viewers: number;
  total_views: number;
}

/** REPEAT_PEOPLE_COLUMNS が返す列 */
export interface RepeatAgg {
  people: number;
  repeaters: number;
}

/** HOST_COUNT_COLUMNS が返す列 */
export interface HostAgg {
  hosts: number;
  repeat_hosts: number;
  total_held: number;
}

/** COUNT_BUCKET_COLUMNS が返す列（今期間ぶんだけ） */
export interface CountBucketRow {
  c1: number;
  c2: number;
  c3: number;
  c45: number;
  c610: number;
  c11: number;
}

/** 参加回数の分布。区切りは COUNT_BUCKET_COLUMNS と対（片方だけ直さない） */
export function countDistribution(
  r: CountBucketRow | null,
): KpiDistributionBucket[] {
  return [
    { label: "1回", users: N(r?.c1) },
    { label: "2回", users: N(r?.c2) },
    { label: "3回", users: N(r?.c3) },
    { label: "4〜5回", users: N(r?.c45) },
    { label: "6〜10回", users: N(r?.c610) },
    { label: "11回以上", users: N(r?.c11) },
  ];
}

/* ---------------- 画面のタイル（両方に同じ形で出る指標）---------------- */

/** 率の出し方。全体KPIは素の rate、コミュニティKPIは母数ゲート付き (rateMin) */
export type RateFn = (numerator: number, denominator: number) => number | null;

/** 全体KPIとコミュニティKPIに**同じ形で出るタイル**（北極星・参加者・不発・主催者）。
 * 両方の periodMetrics がこれを通すので、片方だけ数え方がずれることがない。
 *
 * 2つの画面の違いは「率に母数ゲートを掛けるかどうか」だけ。ゲートを通すのは
 * repeatRate / dudRate / repeatHostRate の3つで、それ以外
 * （avgParticipantsPerEvent・viewToJoinRate・attendanceRate・cancelRate・
 * lateCancelRate・avgEventsPerHost）は**どちらの画面でも素の rate**。
 * 平均は「率」ではなく件数÷人数の目安なのでゲートを掛けない。
 *
 * @param gate 率のゲート。全体KPIは rate をそのまま渡す（＝ゲート無し） */
export function sharedMetrics<
  E extends HeldEventAgg,
  M extends RegistrationAgg,
  V extends ViewAgg,
  R extends RepeatAgg,
  H extends HostAgg,
>(
  s: {
    event: AggPick<E>;
    member: AggPick<M>;
    view: AggPick<V>;
    repeat: AggPick<R>;
    host: AggPick<H>;
  },
  gate: RateFn,
) {
  const heldEvents = s.event("held_events");
  const participations = s.event("held_participations");
  // 出席チェックを有効にしたのに記録が0件のイベントは「不発」ではなく「未記録」。
  // 参加者数が構造的に0になるため、分子・分母の両方から外す
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

  const hosts = s.host("hosts");
  const heldEventsWithActiveHost = s.host("total_held");
  const repeatHosts = s.host("repeat_hosts");

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
    // 分母は「期間内に参加した実人数」。コミュニティKPIでは新規流入と同じ
    // セクションに並ぶので、そちらだけ母数ゲートを通す
    repeatRate: gate(repeaters, people),

    dudEvents,
    attendanceUnrecordedEvents,
    dudBaseEvents,
    // 開催1件で1件が不発なら100% になる。立ち上げ期の主催者が最初に見る数字なので
    // コミュニティKPIでは特にゲートを効かせる（件数はそのまま出す）
    dudRate: gate(dudEvents, dudBaseEvents),
    hosts,
    heldEventsWithActiveHost,
    repeatHosts,
    repeatHostRate: gate(repeatHosts, hosts),
    avgEventsPerHost: rate(heldEventsWithActiveHost, hosts),
  };
}
