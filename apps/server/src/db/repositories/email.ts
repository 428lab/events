import { many, one, run } from "../client.js";
import { jstDayStart } from "../../lib/dateFormat.js";

/** 前日リマインダーの送信対象（イベント×参加者） (#126) */
export interface ReminderTarget {
  memberId: string;
  userId: string;
  email: string;
  eventId: string;
  title: string;
  startsAt: number;
  venueType: string;
  venueOffline: string | null;
  venueOnline: string | null;
}

interface ReminderRow {
  member_id: string;
  user_id: string;
  email: string;
  event_id: string;
  title: string;
  starts_at: number;
  venue_type: string;
  venue_offline: string | null;
  venue_online: string | null;
}

/** メール通知 (#126)。宛先の解決と前日リマインダーの対象抽出。
 * メール通知の既定はオン (#414): 設定行なし＝オン、明示オフ（email_enabled=0 の行あり）だけ除外。
 * この既定は全経路（通知メール・一斉連絡・リマインダー）で `COALESCE(p.email_enabled, 1) = 1`
 * に統一する。経路ごとに既定が割れると「届く/届かない」が経路で変わる事故になる */
export const emailRepo = {
  /** メール通知が有効 かつ 検証済みメールを持つユーザーの宛先を返す（無ければ null）。
   * メールは最後に作成された identity のものを使う */
  async findRecipient(userId: string): Promise<string | null> {
    const row = await one<{ email: string }>(
      // 退会申請中 (#250) には通知メールを送らない
      `SELECT i.email AS email
       FROM user u
       JOIN identity i ON i.user_id = u.id
       LEFT JOIN notification_pref p ON p.user_id = u.id
       WHERE u.id = ? AND u.deleted_at IS NULL
         AND COALESCE(p.email_enabled, 1) = 1 AND i.email IS NOT NULL
       ORDER BY i.created_at DESC LIMIT 1`,
      userId,
    );
    return row?.email ?? null;
  },

  /** 複数ユーザーのうちメール通知が有効な宛先を一括解決（createForMany 用） */
  async findRecipientsAmong(
    userIds: string[],
  ): Promise<Array<{ userId: string; email: string }>> {
    const out: Array<{ userId: string; email: string }> = [];
    // D1 のバインド上限を超えないよう分割して IN 検索
    const CHUNK = 90;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await many<{ user_id: string; email: string | null }>(
        `SELECT u.id AS user_id,
                (SELECT i.email FROM identity i
                 WHERE i.user_id = u.id AND i.email IS NOT NULL
                 ORDER BY i.created_at DESC LIMIT 1) AS email
         FROM user u
         LEFT JOIN notification_pref p ON p.user_id = u.id
         WHERE u.id IN (${placeholders}) AND u.deleted_at IS NULL
           AND COALESCE(p.email_enabled, 1) = 1`,
        ...chunk,
      );
      for (const r of rows) {
        if (r.email != null) out.push({ userId: r.user_id, email: r.email });
      }
    }
    return out;
  },

  /** ユーザーの最新 identity のメール（オプトイン状態は見ない。設定画面の表示用） */
  async latestIdentityEmail(userId: string): Promise<string | null> {
    const row = await one<{ email: string }>(
      `SELECT email FROM identity
       WHERE user_id = ? AND email IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      userId,
    );
    return row?.email ?? null;
  },

  /** 前日リマインダーの対象を抽出 (#126, #411)。
   * 公開済み・日程確定・開始が now より後〜JST の「明日」の終わり（明後日 0:00 JST）
   * のイベントの confirmed メンバーのうち、未送信・メール通知ON・検証済みメール有りのみ。
   * 窓を暦日で切るので夕方開催も前日の実行で対象になる。本日中の未送信分
   * （公開が遅れた等）も拾う（#128 の取りこぼし対策。件名は呼び出し側で出し分け） */
  async listReminderTargets(now: number, limit: number): Promise<ReminderTarget[]> {
    const rows = await many<ReminderRow>(
      `SELECT em.id AS member_id, em.user_id AS user_id,
              (SELECT i.email FROM identity i
               WHERE i.user_id = em.user_id AND i.email IS NOT NULL
               ORDER BY i.created_at DESC LIMIT 1) AS email,
              e.id AS event_id, e.title, e.starts_at,
              e.venue_type, e.venue_offline, e.venue_online
       FROM event e
       JOIN event_member em ON em.event_id = e.id
       -- 設定行なしは既定オン (#414)。明示オフだけ除外する
       LEFT JOIN notification_pref p ON p.user_id = em.user_id
       -- 退会申請中 (#250) には送らない
       JOIN user u ON u.id = em.user_id AND u.deleted_at IS NULL
       WHERE COALESCE(p.email_enabled, 1) = 1
         AND e.status = 'published' AND e.scheduling = 0
         AND e.starts_at > ? AND e.starts_at < ?
         AND em.status = 'confirmed'
         AND em.reminder_sent_at IS NULL
         AND EXISTS (SELECT 1 FROM identity i
                     WHERE i.user_id = em.user_id AND i.email IS NOT NULL)
       ORDER BY e.starts_at ASC
       LIMIT ?`,
      now,
      jstDayStart(now, 2),
      limit,
    );
    return rows.map((r) => ({
      memberId: r.member_id,
      userId: r.user_id,
      email: r.email,
      eventId: r.event_id,
      title: r.title,
      startsAt: r.starts_at,
      venueType: r.venue_type,
      venueOffline: r.venue_offline,
      venueOnline: r.venue_online,
    }));
  },

  /** リマインダー送信済みを記録 */
  async markReminderSent(memberId: string): Promise<void> {
    await run(
      "UPDATE event_member SET reminder_sent_at = ? WHERE id = ?",
      Date.now(),
      memberId,
    );
  },

  /** ワンクリック配信停止：メール通知のみ OFF にする（行が無ければ作る） */
  async disableEmail(userId: string): Promise<void> {
    await run(
      `INSERT INTO notification_pref (user_id, email_enabled, updated_at)
       VALUES (?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email_enabled = 0,
         updated_at = excluded.updated_at`,
      userId,
      Date.now(),
    );
  },
};
