import {
  BROADCAST_SEGMENTS,
  type BroadcastEmailStats,
  type BroadcastSegment,
  type EventBroadcast,
} from "@eventer/shared";
import { batch, many, one, run } from "../client.js";

/**
 * 参加者への一斉連絡 (#172)。
 *
 * 送信先の絞り込み・送信履歴・メールの送信待ちを扱う。
 */

/**
 * 区分ごとの WHERE 条件。
 *
 * 共通の前提（下の FROM 句で担保する）:
 * - そのイベントの event_member 行であること
 * - 退会申請中・退会済み (#250) のユーザーは含めない。届かないうえ、猶予期間中の
 *   人にイベントの連絡を送っても意味がないため
 *
 * 区分ごとの考え方:
 * - all           : 参加を取り消した人以外すべて。eventMembersRepo.find が
 *                   「現役メンバー」を status <> 'canceled' で見るのと揃える
 * - confirmed     : **参加者ロールだけ**。スタッフ/審査員/観覧者は参加枠を消費せず
 *                   確定扱いになる (#277) ので、role を見ないと「確定」に運営側が
 *                   混ざる。ここが混ざると参加者向けの連絡が運営にも飛ぶ
 * - waitlist      : 先着枠が満員でキャンセル待ちの参加者
 * - lottery_won   : 抽選枠 (selection_type='lottery') で確定している参加者。
 *                   先着枠の確定者と区別するため枠の方式まで見る
 * - lottery_lost  : 抽選枠で落選した参加者
 * - staff/judge/observer : そのロールの人（取り消し済みは除く）
 * - attended      : 受付で出席が記録された人。ロールは問わない（スタッフも受付を通る）
 * - not_attended  : 参加確定だったのに出席の記録がない**参加者**。
 *                   participationStats の no-show と同じ考え方に揃える。
 *                   出席チェックを使っていないイベントでは確定者全員がここに入る
 */
const SEGMENT_CONDITIONS: Record<BroadcastSegment, string> = {
  all: "m.status <> 'canceled'",
  confirmed: "m.role = 'participant' AND m.status = 'confirmed'",
  waitlist: "m.role = 'participant' AND m.status = 'waitlist'",
  lottery_won:
    "m.role = 'participant' AND m.status = 'confirmed' AND s.selection_type = 'lottery'",
  lottery_lost:
    "m.role = 'participant' AND m.status = 'lost' AND s.selection_type = 'lottery'",
  staff: "m.role = 'staff' AND m.status <> 'canceled'",
  judge: "m.role = 'judge' AND m.status <> 'canceled'",
  observer: "m.role = 'observer' AND m.status <> 'canceled'",
  attended: "m.status <> 'canceled' AND m.attended = 1",
  not_attended:
    "m.role = 'participant' AND m.status = 'confirmed' AND m.attended = 0",
};

/** 宛先の母集団。退会申請中 (#250) を除き、抽選の当落判定のため枠も引く */
const RECIPIENT_FROM = `FROM event_member m
     JOIN user u ON u.id = m.user_id AND u.deleted_at IS NULL
     LEFT JOIN participation_slot s ON s.id = m.slot_id
    WHERE m.event_id = ?`;

interface BroadcastRow {
  id: string;
  segment: string;
  title: string;
  body: string;
  sender_name: string | null;
  recipient_count: number;
  created_at: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

function toBroadcast(r: BroadcastRow): EventBroadcast {
  return {
    id: r.id,
    segment: r.segment,
    title: r.title,
    body: r.body,
    senderName: r.sender_name,
    recipientCount: r.recipient_count,
    email: {
      pending: r.pending ?? 0,
      sent: r.sent ?? 0,
      failed: r.failed ?? 0,
      skipped: r.skipped ?? 0,
    },
    createdAt: r.created_at,
  };
}

/** メールの送信待ち1件（定期実行が処理する単位） */
export interface PendingBroadcastEmail {
  id: string;
  userId: string;
  eventId: string;
  title: string;
  body: string;
  attempts: number;
}

export const eventBroadcastsRepo = {
  /** 区分に該当するユーザーID。通知の一括作成とメールの積み込みに使う */
  async recipientIds(
    eventId: string,
    segment: BroadcastSegment,
  ): Promise<string[]> {
    const rows = await many<{ user_id: string }>(
      `SELECT m.user_id AS user_id ${RECIPIENT_FROM}
         AND (${SEGMENT_CONDITIONS[segment]})
       ORDER BY m.created_at ASC`,
      eventId,
    );
    return rows.map((r) => r.user_id);
  },

  /** 全区分の人数を1クエリで。送信前の確認に出す「実際の人数」 */
  async countsBySegment(
    eventId: string,
  ): Promise<Record<BroadcastSegment, number>> {
    const sums = BROADCAST_SEGMENTS.map(
      (seg) =>
        `SUM(CASE WHEN ${SEGMENT_CONDITIONS[seg]} THEN 1 ELSE 0 END) AS c_${seg}`,
    ).join(",\n              ");
    const row = await one<Record<string, number | null>>(
      `SELECT ${sums} ${RECIPIENT_FROM}`,
      eventId,
    );
    const out = {} as Record<BroadcastSegment, number>;
    for (const seg of BROADCAST_SEGMENTS) out[seg] = row?.[`c_${seg}`] ?? 0;
    return out;
  },

  /** そのイベントの送信回数（since 以降。上限判定用。since=0 で通算） */
  async countSince(eventId: string, since: number): Promise<number> {
    const row = await one<{ n: number }>(
      "SELECT COUNT(1) AS n FROM event_broadcast WHERE event_id = ? AND created_at >= ?",
      eventId,
      since,
    );
    return row?.n ?? 0;
  },

  async create(input: {
    eventId: string;
    createdBy: string;
    segment: BroadcastSegment;
    title: string;
    body: string;
    recipientCount: number;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO event_broadcast
         (id, event_id, created_by, segment, title, body, recipient_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.eventId,
      input.createdBy,
      input.segment,
      input.title,
      input.body,
      input.recipientCount,
      Date.now(),
    );
    return id;
  },

  /** メールの送信待ちを積む。1人1行。D1 の書き込みをまとめるため分割して batch */
  async queueEmails(broadcastId: string, userIds: string[]): Promise<void> {
    const now = Date.now();
    const CHUNK = 50;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      await batch(
        userIds.slice(i, i + CHUNK).map((userId) => ({
          sql: `INSERT INTO event_broadcast_email
                  (id, broadcast_id, user_id, status, attempts, created_at)
                VALUES (?, ?, ?, 'pending', 0, ?)`,
          args: [crypto.randomUUID(), broadcastId, userId, now],
        })),
      );
    }
  },

  /** 古い送信待ちから順に取り出す。件名・本文は送信時に組み立てるので一緒に引く */
  async listPendingEmails(limit: number): Promise<PendingBroadcastEmail[]> {
    if (limit <= 0) return [];
    const rows = await many<{
      id: string;
      user_id: string;
      event_id: string;
      title: string;
      body: string;
      attempts: number;
    }>(
      `SELECT q.id, q.user_id, q.attempts, b.event_id, b.title, b.body
         FROM event_broadcast_email q
         JOIN event_broadcast b ON b.id = q.broadcast_id
        WHERE q.status = 'pending'
        ORDER BY q.created_at ASC
        LIMIT ?`,
      limit,
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      eventId: r.event_id,
      title: r.title,
      body: r.body,
      attempts: r.attempts,
    }));
  },

  async markEmailSent(id: string): Promise<void> {
    await run(
      "UPDATE event_broadcast_email SET status = 'sent', attempts = attempts + 1, sent_at = ? WHERE id = ?",
      Date.now(),
      id,
    );
  },

  /** 送信できなかった。上限回数に達していたら failed に倒し、それまでは送信待ちのまま */
  async markEmailAttemptFailed(id: string, maxAttempts: number): Promise<void> {
    await run(
      `UPDATE event_broadcast_email
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
        WHERE id = ?`,
      maxAttempts,
      id,
    );
  },

  /** 送信の直前に対象外と分かった（メール通知オフ・宛先なし・退会申請中） */
  async markEmailSkipped(id: string): Promise<void> {
    await run(
      "UPDATE event_broadcast_email SET status = 'skipped', attempts = attempts + 1 WHERE id = ?",
      id,
    );
  },

  /** 送信履歴（新しい順）。メールの送信状況も一緒に集計する */
  async listByEvent(eventId: string, limit = 50): Promise<EventBroadcast[]> {
    const rows = await many<BroadcastRow>(
      `SELECT b.id, b.segment, b.title, b.body, b.recipient_count, b.created_at,
              COALESCE(u.global_name, u.username) AS sender_name,
              COALESCE(SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN q.status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
              COALESCE(SUM(CASE WHEN q.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN q.status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped
         FROM event_broadcast b
         LEFT JOIN user u ON u.id = b.created_by
         LEFT JOIN event_broadcast_email q ON q.broadcast_id = b.id
        WHERE b.event_id = ?
        GROUP BY b.id
        ORDER BY b.created_at DESC
        LIMIT ?`,
      eventId,
      limit,
    );
    return rows.map(toBroadcast);
  },

  /** 1件ぶんのメール送信状況（送信直後の応答に使う） */
  async emailStats(broadcastId: string): Promise<BroadcastEmailStats> {
    const row = await one<BroadcastEmailStats>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
              COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped
         FROM event_broadcast_email WHERE broadcast_id = ?`,
      broadcastId,
    );
    return {
      pending: row?.pending ?? 0,
      sent: row?.sent ?? 0,
      failed: row?.failed ?? 0,
      skipped: row?.skipped ?? 0,
    };
  },
};
