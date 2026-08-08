import type { MeetableEvent } from "@eventer/shared";
import { many, one, runCount } from "../client.js";

/** 開始30分前から「出会った」を受け付ける（開場・受付中の読み合いを想定） */
export const MEET_WINDOW_BEFORE_MS = 30 * 60_000;
/** 終了2時間後まで受け付ける（懇親会・撤収中の読み合いを想定） */
export const MEET_WINDOW_AFTER_MS = 2 * 60 * 60_000;

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

  /** イベント内の出会い数ランキング（スタッフ運営用・景品配布の参考）。両方向を合算 */
  async rankingForEvent(eventId: string): Promise<
    {
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
    }>(
      `SELECT u.id, u.username, u.global_name, u.avatar_url, COUNT(*) AS n
         FROM (
           SELECT user_low AS uid FROM event_meet WHERE event_id = ?
           UNION ALL
           SELECT user_high FROM event_meet WHERE event_id = ?
         ) m
         JOIN user u ON u.id = m.uid AND u.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY n DESC, u.username ASC
        LIMIT 100`,
      eventId,
      eventId,
    );
    return rows.map((r) => ({
      userId: r.id,
      username: r.username,
      name: r.global_name ?? r.username,
      avatarUrl: r.avatar_url,
      count: r.n,
    }));
  },

  /** 両者がいま「出会った」を記録できる共通イベント一覧。
   * 条件: 公開済み・日程確定・開催時間帯（前30分〜後2時間）・両者とも確定メンバー、
   * 出席チェックONのイベントは両者とも出席済みであること */
  async meetableEventsBetween(
    viewerId: string,
    targetId: string,
    now: number,
  ): Promise<MeetableEvent[]> {
    return many<MeetableEvent>(
      `SELECT DISTINCT e.id, e.title
         FROM event e
         JOIN event_member mv ON mv.event_id = e.id
          AND mv.user_id = ? AND mv.status = 'confirmed'
         JOIN event_member mt ON mt.event_id = e.id
          AND mt.user_id = ? AND mt.status = 'confirmed'
        WHERE e.status = 'published' AND e.scheduling = 0
          AND e.starts_at > 0 AND e.ends_at > 0
          AND ? >= e.starts_at - ${MEET_WINDOW_BEFORE_MS}
          AND ? <= e.ends_at + ${MEET_WINDOW_AFTER_MS}
          AND (e.attendance_check = 0 OR (mv.attended = 1 AND mt.attended = 1))
        ORDER BY e.starts_at ASC`,
      viewerId,
      targetId,
      now,
      now,
    );
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
