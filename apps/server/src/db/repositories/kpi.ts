import {
  KPI_DAILY_MAX_DAYS,
  type KpiDailyPoint,
  type KpiDistributionBucket,
  type KpiPayload,
  type KpiPreviousValues,
  type KpiProviderCount,
  addDays,
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
}

/** 参加回数の分布は今期間ぶんだけ（前期間の分布は画面に出さない） */
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
}

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

interface DailyRow {
  day: string;
  signups: number;
  joins: number;
  held_events: number;
  participations: number;
}

interface ActiveRow {
  day: string;
  dau: number;
  /** 週次表示になる長さのときは週の最終日（日曜）以外 null（＝算出していない） */
  mau: number | null;
  measured_from: string | null;
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
         -- 相関サブクエリは開催済みイベントでだけ評価する（下書き・未来のイベントで
         -- 数えても捨てるだけなので CASE で短絡させる）
         SELECT b.*,
                CASE WHEN b.held_p > 0 THEN (
                  -- 実際に集まった人数（主催・スタッフを含む）。イベントページの
                  -- participantCount は確定メンバー数なので、ここは意図的に別定義 (#297)
                  SELECT COUNT(1) FROM event_member em
                   WHERE em.event_id = b.id AND em.status = 'confirmed'
                     AND (b.attendance_check = 0 OR em.attended = 1 OR em.role <> 'participant')
                     AND ${USER_ACTIVE("em.user_id")}
                ) ELSE 0 END AS pcount,
                CASE WHEN b.held_p > 0 THEN (
                  -- 不発判定用。主催・スタッフを含めるとチーム規模でしきい値がぶれる。
                  -- 審査員・観覧者は実際に来る人なので参加者として数える
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
         ${dual("attendance_unrecorded_events", "held_p", "unrecorded = 1")},
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
    // 登録/キャンセルは「登録の作成日」基準、出席は「イベントの終了日」基準なので
    // 期間フラグを2本立てる。主催・スタッフの行（イベント作成時に自動で作られる）と
    // 下書きイベントは除く。除かないとイベントを1件作るたびに参加登録が+1され、
    // キャンセル率が過小に出る。審査員・観覧者は参加登録として数える。
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
       SELECT COALESCE(SUM(CASE WHEN n >= 1 THEN 1 ELSE 0 END), 0) AS people,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN 1 ELSE 0 END), 0) AS prev_people,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeaters,
              COALESCE(SUM(CASE WHEN prev_n >= 2 THEN 1 ELSE 0 END), 0) AS prev_repeaters,
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
       SELECT COALESCE(SUM(CASE WHEN n >= 1 THEN 1 ELSE 0 END), 0) AS hosts,
              COALESCE(SUM(CASE WHEN prev_n >= 1 THEN 1 ELSE 0 END), 0) AS prev_hosts,
              COALESCE(SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END), 0) AS repeat_hosts,
              COALESCE(SUM(CASE WHEN prev_n >= 2 THEN 1 ELSE 0 END), 0) AS prev_repeat_hosts,
              COALESCE(SUM(n), 0) AS total_held,
              COALESCE(SUM(prev_n), 0) AS prev_total_held
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
         FROM event e WHERE ${HELD("e")}
         UNION ALL
         SELECT ${jd("e.ends_at")}, 0, 0, 0, 1
         FROM event_member m JOIN event e ON e.id = m.event_id
         WHERE m.status = 'confirmed'
           AND (e.attendance_check = 0 OR m.attended = 1 OR m.role <> 'participant')
           AND ${MEMBER_USER_ACTIVE} AND ${HELD("e")}
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

/** epoch ms → JST の 'YYYY-MM-DD'（SQL の jd() と同じ基準） */
export function jstDay(at: number): string {
  return new Date(at + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 1つの期間ぶんの指標。今期間・前期間の両方でこの関数を通すので、
 * 片方だけ数え方がずれることがない */
function periodMetrics(s: {
  event: AggPick<EventAgg>;
  member: AggPick<MemberAgg>;
  view: AggPick<ViewAgg>;
  repeat: AggPick<RepeatAgg>;
  host: AggPick<HostAgg>;
  user: AggPick<UserAgg>;
  health: AggPick<HealthAgg>;
  matching: AggPick<MatchingAgg>;
}) {
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
    repeatRate: rate(repeaters, people),

    createdEvents: s.event("created_events"),
    draftEvents: s.event("draft_events"),
    publishedEvents: s.event("published_events"),
    schedulingEvents: s.event("scheduling_events"),
    schedulingUsedEvents: schedulingUsed,
    schedulingConfirmedEvents: schedulingConfirmed,
    schedulingConfirmRate: rate(schedulingConfirmed, schedulingUsed),
    dudEvents,
    attendanceUnrecordedEvents,
    dudBaseEvents,
    dudRate: rate(dudEvents, dudBaseEvents),
    hosts,
    heldEventsWithActiveHost,
    repeatHosts: s.host("repeat_hosts"),
    repeatHostRate: rate(s.host("repeat_hosts"), hosts),
    avgEventsPerHost: rate(heldEventsWithActiveHost, hosts),

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

/** 日次系列の最大点数。?days=3650 のような長い指定でも点数に上限を掛ける。
 * **切り捨てるのは古い側**（開始日をクランプする）。ループの途中で break すると
 * 落ちるのが新しい側になり、直近ぶんが警告も無くグラフから消える。 */
export const MAX_SERIES_POINTS = 3000;

/** 系列の開始日。上限を超える長さのときは「新しい側を必ず残す」ように古い側を切る */
export function clampSeriesStart(first: string, today: string): string {
  const limit = addDays(today, -(MAX_SERIES_POINTS - 1));
  return first < limit ? limit : first;
}

/** 日次の系列を「抜けの無い日付」に整える (#266)。
 * 活動ゼロの日は 0 で埋める。DAU/MAU は計測開始 (#257) より前を null にして、
 * 「0人だった日」と「まだ計測していない日」を区別する。
 *
 * @param from 期間の開始日。'0000'（全期間）のときはデータのある最初の日 */
export function fillDailySeries(
  from: string,
  today: string,
  daily: DailyRow[],
  active: ActiveRow[],
): KpiDailyPoint[] {
  const measuredFrom = active[0]?.measured_from ?? null;
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const activeByDay = new Map(active.map((a) => [a.day, a]));
  const start =
    from !== "0000"
      ? from
      : [daily[0]?.day, active[0]?.day].filter((d): d is string => !!d).sort()[0];
  if (!start || start > today) return [];
  const first = clampSeriesStart(start, today);

  const out: KpiDailyPoint[] = [];
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const d = byDay.get(day);
    const a = activeByDay.get(day);
    const measured = measuredFrom !== null && day >= measuredFrom;
    out.push({
      day,
      signups: N(d?.signups),
      joins: N(d?.joins),
      heldEvents: N(d?.held_events),
      participations: N(d?.participations),
      dau: measured ? N(a?.dau) : null,
      // MAU は週次表示になる長さのとき週の最終日ぶんだけ算出する（クエリ (8) 参照）。
      // 「計測済みだが算出していない日」を 0 で埋めると MAU が落ちたように見えるので
      // null のまま返す（週次まとめは週の最終の既知値を採る）
      mau: measured ? (a?.mau ?? null) : null,
    });
  }
  return out;
}

function buildPayload(src: {
  days: number | null;
  sinceDay: string;
  prevSinceDay: string;
  today: string;
  eventAgg: Dual<EventAgg> | null;
  memberAgg: Dual<MemberAgg> | null;
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
    member: picker<MemberAgg>(src.memberAgg, prefix),
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

  const r = src.repeatAgg;
  const countDistribution: KpiDistributionBucket[] = [
    { label: "1回", users: N(r?.c1) },
    { label: "2回", users: N(r?.c2) },
    { label: "3回", users: N(r?.c3) },
    { label: "4〜5回", users: N(r?.c45) },
    { label: "6〜10回", users: N(r?.c610) },
    { label: "11回以上", users: N(r?.c11) },
  ];

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
      countDistribution,
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
