import type { GamificationStats } from "@eventer/shared";
import { one } from "../client.js";

/** ゲーミフィケーション (#14)。専用テーブルは持たず、既存データから毎回導出する。
 * 「有効イベント」= 公開済み・終了済み・確定メンバー4人以上。
 * 少人数イベントの乱造によるXPインフレを防ぐため、全カウントをこの基準で絞る。 */
export const gamificationRepo = {
  /** ユーザーの実績カウント一式を有効イベント基準で集計する。
   * CTE で有効イベントを1回だけ求め、5つの集計をスカラサブクエリでまとめて取る */
  async statsForUser(userId: string, now: number): Promise<GamificationStats> {
    const row = await one<{
      hosted: number;
      staffed: number;
      spoken: number;
      attended: number;
      likes: number;
      meets: number;
    }>(
      // 有効イベントの人数判定・被いいねの集計とも、退会申請中 (#250) は
      // 数えない（参加者一覧・いいね集計の見え方と揃える）
      `WITH qual AS (
         SELECT e.id, e.created_by, e.attendance_check
           FROM event e
          WHERE e.status = 'published' AND e.ends_at > 0 AND e.ends_at < ?
            AND (SELECT COUNT(*) FROM event_member m
                  JOIN user mu ON mu.id = m.user_id AND mu.deleted_at IS NULL
                  WHERE m.event_id = e.id AND m.status = 'confirmed') >= 4
       )
       SELECT
         -- 主催: オーナー本人の確定スタッフ行がある有効イベント
         (SELECT COUNT(*) FROM event_member m JOIN qual q ON q.id = m.event_id
           WHERE m.user_id = ? AND m.role = 'staff' AND m.status = 'confirmed'
             AND q.created_by = m.user_id) AS hosted,
         -- スタッフ: オーナー以外の確定スタッフ行
         (SELECT COUNT(*) FROM event_member m JOIN qual q ON q.id = m.event_id
           WHERE m.user_id = ? AND m.role = 'staff' AND m.status = 'confirmed'
             AND q.created_by <> m.user_id) AS staffed,
         -- 登壇: タイムテーブル担当リンク（同一イベント複数コマは1）
         (SELECT COUNT(DISTINCT q.id) FROM event_schedule_item si
           JOIN qual q ON q.id = si.event_id
           WHERE si.speaker_user_id = ?) AS spoken,
         -- 参加: 確定参加者で出席扱い（未チェック運用は登録=出席）
         (SELECT COUNT(*) FROM event_member m JOIN qual q ON q.id = m.event_id
           WHERE m.user_id = ? AND m.role = 'participant' AND m.status = 'confirmed'
             AND (q.attendance_check = 0 OR m.attended = 1)) AS attended,
         -- 被いいね: 主催・スタッフ・参加者としてもらったいいね
         (SELECT COUNT(*) FROM event_like l JOIN qual q ON q.id = l.event_id
           JOIN user lu ON lu.id = l.user_id AND lu.deleted_at IS NULL
           WHERE l.kind IN ('host', 'staff', 'participant')
             AND l.target_key = ?) AS likes,
         -- 出会った: QR読み合いの記録 (#189)。イベントごとに上限件数まで数える
         (SELECT COALESCE(SUM(cnt), 0) FROM (
            SELECT COUNT(*) AS cnt FROM event_meet em
              JOIN qual q ON q.id = em.event_id
             WHERE em.user_low = ? OR em.user_high = ?
             GROUP BY em.event_id)) AS meets`,
      now,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
    );
    return {
      hosted: row?.hosted ?? 0,
      staffed: row?.staffed ?? 0,
      spoken: row?.spoken ?? 0,
      attendedQualifying: row?.attended ?? 0,
      likesReceivedQualifying: row?.likes ?? 0,
      meets: row?.meets ?? 0,
    };
  },
};
