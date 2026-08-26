import type { MeetableEvent } from "@eventer/shared";
import { many, one, runCount } from "../client.js";

/** 開始30分前から「出会った」を受け付ける（開場・受付中の読み合いを想定） */
export const MEET_WINDOW_BEFORE_MS = 30 * 60_000;
/** 終了2時間後まで受け付ける（懇親会・撤収中の読み合いを想定） */
export const MEET_WINDOW_AFTER_MS = 2 * 60 * 60_000;

/** 共通イベント1件ぶんの、両者のイベント内ロールと出席状況 (#330)。
 * 出席の自動付与（相手が staff なら読み取った側を出席にする）の判断に使う */
export interface MeetablePair extends MeetableEvent {
  /** 開始時刻。出席を付ける「いま居る回」を1件に絞るのに使う */
  startsAt: number;
  /** 出席チェックを使うイベントか。出席の自動付与はこれが有効なときだけ行う */
  attendanceCheck: boolean;
  viewerRole: string;
  targetRole: string;
  viewerAttended: boolean;
  targetAttended: boolean;
}

/**
 * イベント内の「1人あたりの出会い件数」（両方向を合算）のサブクエリ (#418)。
 * プレースホルダは eventId ×2。
 *
 * ランキング系（named・anonymous・本人の順位・母数）はすべてこの1本を土台にする。
 * 同じ集計を別の場所に書かないこと（docs/meet-ranking.md §3.8 の経路表を守る要）。
 */
const PER_USER_COUNTS_SQL = `
  SELECT u.id, u.username, u.global_name, u.avatar_url, COUNT(*) AS n
    FROM (
      SELECT user_low AS uid FROM event_meet WHERE event_id = ?
      UNION ALL
      SELECT user_high FROM event_meet WHERE event_id = ?
    ) m
    JOIN user u ON u.id = m.uid AND u.deleted_at IS NULL
   GROUP BY u.id`;

/** 参加者同士の「出会った」記録 (#189)。ペアはイベントごとに1回（順序に依らず正規化して保存） */
export const eventMeetsRepo = {
  /** 出会いを記録する。ペアを (小,大) に正規化し INSERT OR IGNORE で冪等。
   * created=false は同じペアで記録済みだったことを表す */
  async recordMeet(
    eventId: string,
    userIdA: string,
    userIdB: string,
  ): Promise<{ created: boolean }> {
    const [low, high] =
      userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
    const changes = await runCount(
      `INSERT OR IGNORE INTO event_meet (id, event_id, user_low, user_high, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      eventId,
      low,
      high,
      Date.now(),
    );
    return { created: changes > 0 };
  },

  /** イベント内の出会い数ランキング（名前入り）。
   * スタッフ運営用（景品配布の参考・上位100）と、named モードの投影 (#418・上位10) が共用する。
   * rank は競技順位（同数は同順位、次は人数分飛ぶ）。表示順の第2キーを username に
   * 固定しているのは、ポーリングのたびに同率内で行が入れ替わってちらつかないようにするため */
  async rankingForEvent(
    eventId: string,
    limit = 100,
  ): Promise<
    {
      rank: number;
      userId: string;
      username: string;
      name: string;
      avatarUrl: string | null;
      count: number;
    }[]
  > {
    const rows = await many<{
      id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      n: number;
      rnk: number;
    }>(
      `SELECT id, username, global_name, avatar_url, n,
              RANK() OVER (ORDER BY n DESC) AS rnk
         FROM (${PER_USER_COUNTS_SQL}) t
        ORDER BY n DESC, username ASC
        LIMIT ?`,
      eventId,
      eventId,
      limit,
    );
    return rows.map((r) => ({
      rank: r.rnk,
      userId: r.id,
      username: r.username,
      name: r.global_name ?? r.username,
      avatarUrl: r.avatar_url,
      count: r.n,
    }));
  },

  /** 匿名モードのランキング (#418)。件数ごとに集約し、個人を指す値を一切返さない。
   * 匿名を名乗る以上、名前を落とすのはクライアントではなくここ（サーバー側）の責務 */
  async anonymousRankingForEvent(
    eventId: string,
    limit: number,
  ): Promise<{ rank: number; count: number; people: number }[]> {
    const rows = await many<{ n: number; people: number }>(
      `SELECT n, COUNT(*) AS people
         FROM (${PER_USER_COUNTS_SQL}) t
        GROUP BY n
        ORDER BY n DESC
        LIMIT ?`,
      eventId,
      eventId,
      limit,
    );
    // 競技順位: その件数の順位 = それより多い件数の人数 + 1
    let above = 0;
    return rows.map((r) => {
      const rank = above + 1;
      above += r.people;
      return { rank, count: r.n, people: r.people };
    });
  },

  /** 1件以上記録した人数 (#418)。投影の「これまでに N 人が出会いを記録」用 */
  async countRankedForEvent(eventId: string): Promise<number> {
    const row = await one<{ v: number }>(
      `SELECT COUNT(*) AS v FROM (${PER_USER_COUNTS_SQL}) t`,
      eventId,
      eventId,
    );
    return row?.v ?? 0;
  },

  /** 本人の順位と件数 (#418)。0件なら null（圏外ではなく「まだ記録が無い」） */
  async rankForUser(
    eventId: string,
    userId: string,
  ): Promise<{ rank: number; count: number } | null> {
    const count = await this.countedMeetsForUser(eventId, userId);
    if (count === 0) return null;
    const above = await one<{ v: number }>(
      `SELECT COUNT(*) AS v FROM (${PER_USER_COUNTS_SQL}) t WHERE t.n > ?`,
      eventId,
      eventId,
      count,
    );
    return { rank: (above?.v ?? 0) + 1, count };
  },

  /** 両者がいま出会いを記録できる共通イベントを、双方のロール・出席状況つきで返す。
   * 条件: 公開済み・日程確定・開催時間帯（前30分〜後2時間）・両者とも確定メンバー。
   *
   * 「両者とも出席済み」の条件は #330 で外した。出席チェックONのイベントで受付を
   * 通していない相手と記録できず、実際のイベントで「出会ったボタンが出ない」事象が
   * 起きたため。使い捨てQRを読めている時点で対面は担保されるので、参加確定と
   * 開催時間帯だけを条件にする。 */
  async meetablePairsBetween(
    viewerId: string,
    targetId: string,
    now: number,
  ): Promise<MeetablePair[]> {
    const rows = await many<{
      id: string;
      title: string;
      starts_at: number;
      attendance_check: number;
      viewer_role: string;
      target_role: string;
      viewer_attended: number;
      target_attended: number;
    }>(
      `SELECT DISTINCT e.id, e.title, e.starts_at, e.attendance_check,
              mv.role AS viewer_role, mt.role AS target_role,
              mv.attended AS viewer_attended, mt.attended AS target_attended
         FROM event e
         JOIN event_member mv ON mv.event_id = e.id
          AND mv.user_id = ? AND mv.status = 'confirmed'
         JOIN event_member mt ON mt.event_id = e.id
          AND mt.user_id = ? AND mt.status = 'confirmed'
        WHERE e.status = 'published' AND e.scheduling = 0
          AND e.starts_at > 0 AND e.ends_at > 0
          AND ? >= e.starts_at - ${MEET_WINDOW_BEFORE_MS}
          AND ? <= e.ends_at + ${MEET_WINDOW_AFTER_MS}
        ORDER BY e.starts_at ASC`,
      viewerId,
      targetId,
      now,
      now,
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: r.starts_at,
      attendanceCheck: r.attendance_check === 1,
      viewerRole: r.viewer_role,
      targetRole: r.target_role,
      viewerAttended: r.viewer_attended === 1,
      targetAttended: r.target_attended === 1,
    }));
  },

  /** 記録できなかったときの理由を切り分ける (#330)。
   * meetablePairsBetween が空だったときだけ呼ぶ。利用者に「共通イベントがない」のか
   * 「時間帯の外」なのか「どちらの参加が未確定なのか」を伝えるためのもの。
   *
   * 1本目は meetablePairsBetween から「開催時間帯」だけを落とした条件にする。
   * 日程調整中や日時未定のイベントまで拾うと、真の原因（相手がキャンセル待ち等）が
   * 「時間帯の外」に隠れてしまうため。 */
  async diagnoseUnmeetable(
    viewerId: string,
    targetId: string,
  ): Promise<
    | "outside_window"
    | "not_confirmed_me"
    | "not_confirmed_target"
    | "no_shared_event"
  > {
    // 時間帯を問わず、両者とも確定メンバーの「日時が決まった公開イベント」があるか
    const timing = await one<{ v: number }>(
      `SELECT 1 AS v
         FROM event e
         JOIN event_member mv ON mv.event_id = e.id
          AND mv.user_id = ? AND mv.status = 'confirmed'
         JOIN event_member mt ON mt.event_id = e.id
          AND mt.user_id = ? AND mt.status = 'confirmed'
        WHERE e.status = 'published' AND e.scheduling = 0
          AND e.starts_at > 0 AND e.ends_at > 0
        LIMIT 1`,
      viewerId,
      targetId,
    );
    if (timing) return "outside_window";
    // 参加状態を問わず両者がメンバー行を持つ公開イベントを探し、
    // どちら側が確定していないのかまで返す（案内の宛先が変わるため）
    const pending = await one<{ viewer_ok: number; target_ok: number }>(
      `SELECT MAX(CASE WHEN mv.status = 'confirmed' THEN 1 ELSE 0 END) AS viewer_ok,
              MAX(CASE WHEN mt.status = 'confirmed' THEN 1 ELSE 0 END) AS target_ok
         FROM event e
         JOIN event_member mv ON mv.event_id = e.id AND mv.user_id = ?
         JOIN event_member mt ON mt.event_id = e.id AND mt.user_id = ?
        WHERE e.status = 'published'`,
      viewerId,
      targetId,
    );
    if (!pending || pending.viewer_ok === null) return "no_shared_event";
    // 両方が未確定なら、まず自分の側を案内する（自分で動かせるのはこちらだけ）
    return pending.viewer_ok === 1 ? "not_confirmed_target" : "not_confirmed_me";
  },

  /** 出会いの記録を取り消す (#330)。誤って読み取ったとき用。
   * 消えた行があれば true（元から無ければ false） */
  async deleteMeet(
    eventId: string,
    userIdA: string,
    userIdB: string,
  ): Promise<boolean> {
    const [low, high] =
      userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
    const changes = await runCount(
      "DELETE FROM event_meet WHERE event_id = ? AND user_low = ? AND user_high = ?",
      eventId,
      low,
      high,
    );
    return changes > 0;
  },

  /** イベント内でユーザーがXPに数えられる出会い数（上限適用済み） */
  async countedMeetsForUser(eventId: string, userId: string): Promise<number> {
    const row = await one<{ v: number }>(
      `SELECT COUNT(*) AS v FROM event_meet
        WHERE event_id = ? AND (user_low = ? OR user_high = ?)`,
      eventId,
      userId,
      userId,
    );
    return row?.v ?? 0;
  },

  /** ユーザーの出会い数を、イベントごとにまとめて数える (#315)。
   * 年表はイベント1件ごとに人数を出すが、countedMeetsForUser をイベント数ぶん
   * 呼ぶと N+1 になるので、GROUP BY で1本にまとめている。
   * 0人のイベントは行自体が返らない（呼び出し側は「キーが無い＝0人」として扱う） */
  async countsByEventForUser(userId: string): Promise<Map<string, number>> {
    const rows = await many<{ event_id: string; n: number }>(
      `SELECT event_id, COUNT(*) AS n FROM event_meet
        WHERE user_low = ? OR user_high = ?
        GROUP BY event_id`,
      userId,
      userId,
    );
    return new Map(rows.map((r) => [r.event_id, r.n]));
  },

  /** 通算で出会った「人数」 (#315)。プロフィール上部に固定で出す値。
   *
   * event_meet はイベントごとに1行なので、素の COUNT(*) だと同じ人と3つの
   * イベントで会えば3になる（イベント×相手の延べ数）。ここは人数なので
   * 相手側の user_id で DISTINCT を取る。
   * 年表に並んでいる行の合計で作ると絞り込み・非公開化でずれるため、
   * 表示とは独立にここで数える */
  async totalMeetsForUser(userId: string): Promise<number> {
    const row = await one<{ v: number }>(
      `SELECT COUNT(DISTINCT CASE WHEN user_low = ? THEN user_high ELSE user_low END) AS v
         FROM event_meet
        WHERE user_low = ? OR user_high = ?`,
      userId,
      userId,
      userId,
    );
    return row?.v ?? 0;
  },
};
