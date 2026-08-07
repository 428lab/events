import {
  BROADCAST_SEGMENTS,
  type BroadcastEmailStats,
  type BroadcastSegment,
  type EventBroadcast,
} from "@eventer/shared";
import { batch, many, one, run, runCount } from "../client.js";

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
 * - all           : **これから参加しうる人**に絞る。参加を取り消した人は本人の意思で
 *                   降りているので送らない。落選した参加者も、もう参加できないのに
 *                   直前の連絡（持ち物・集合場所）が届くのは混乱のもとなので外す。
 *                   落選した人向けの連絡は lost 区分から送れる。
 *                   逆に抽選の申込中はまだ当選しうるので含める（先着のキャンセル待ちを
 *                   含めるのと同じ扱い。ここを非対称にする理由がない）。
 *
 *                   条件を「status の否定リスト」で書かないこと。参加者以外は参加枠を
 *                   消費しない (#277) ようになる前のデータに、status が 'lost' や
 *                   'applied' のまま残っているスタッフ行が実在する（migration 0061 が
 *                   整理しているのがまさにそれ）。否定リストで書くとそのスタッフが
 *                   「全員」から静かに漏れる。参加者ロールとそれ以外で分けて、
 *                   落選の除外は参加者ロールにだけ効かせる
 * - confirmed     : **参加者ロールだけ**。スタッフ/審査員/観覧者は参加枠を消費せず
 *                   確定扱いになる (#277) ので、role を見ないと「確定」に運営側が
 *                   混ざる。ここが混ざると参加者向けの連絡が運営にも飛ぶ
 * - waitlist      : 先着枠が満員でキャンセル待ちの参加者
 * - lottery_won   : 抽選枠 (selection_type='lottery') で確定している参加者。
 *                   status='confirmed' だけでは先着枠の確定者と区別できないので、
 *                   ここは枠の方式まで見る
 * - lost          : 落選したまま参加していない参加者。**枠は見ない**。
 *                   抽選後に枠を消すと slot_id が NULL になって status='lost' だけが
 *                   残るし、先着枠でも手で落選にできる。枠の方式を条件に入れると
 *                   その人たちがどの区分でも拾えなくなる。status='lost' は意味として
 *                   落選しかないので、枠を落としても判別力は落ちない
 * - staff/judge/observer : そのロールの人（取り消し済みは除く）。ここも status の
 *                   否定は 'canceled' だけにする（上の all と同じ理由）
 * - attended      : 受付で出席が記録された人。ロールは問わない（スタッフも受付を通る）
 * - not_attended  : 参加確定だったのに出席の記録がない**参加者**。
 *                   participationStats の no-show と同じ考え方に揃える。
 *                   出席チェックを使っていないイベントでは確定者全員がここに入る
 */
const SEGMENT_CONDITIONS: Record<BroadcastSegment, string> = {
  all: `(m.role <> 'participant' AND m.status <> 'canceled')
        OR (m.role = 'participant' AND m.status <> 'canceled' AND m.status <> 'lost')`,
  confirmed: "m.role = 'participant' AND m.status = 'confirmed'",
  waitlist: "m.role = 'participant' AND m.status = 'waitlist'",
  lottery_won:
    "m.role = 'participant' AND m.status = 'confirmed' AND s.selection_type = 'lottery'",
  lost: "m.role = 'participant' AND m.status = 'lost'",
  staff: "m.role = 'staff' AND m.status <> 'canceled'",
  judge: "m.role = 'judge' AND m.status <> 'canceled'",
  observer: "m.role = 'observer' AND m.status <> 'canceled'",
  attended: "m.status <> 'canceled' AND m.attended = 1",
  not_attended:
    "m.role = 'participant' AND m.status = 'confirmed' AND m.attended = 0",
};

/** 宛先の母集団。退会申請中 (#250) を除き、抽選の当選判定のため枠も引く */
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
  incomplete: number;
  created_at: number;
  email_pending: number;
  email_sent: number;
  email_failed: number;
  email_skipped: number;
}

function toBroadcast(r: BroadcastRow): EventBroadcast {
  return {
    id: r.id,
    segment: r.segment,
    title: r.title,
    body: r.body,
    senderName: r.sender_name,
    recipientCount: r.recipient_count,
    incomplete: r.incomplete === 1,
    email: {
      pending: r.email_pending ?? 0,
      sent: r.email_sent ?? 0,
      failed: r.email_failed ?? 0,
      skipped: r.email_skipped ?? 0,
    },
    createdAt: r.created_at,
  };
}

/** まだメールを送り終わっていない連絡（定期実行が取り出す単位） */
export interface PendingBroadcast {
  id: string;
  eventId: string;
  title: string;
  body: string;
}

/** 取り出した（sending に倒した）送信待ち1件 */
export interface ClaimedBroadcastEmail {
  id: string;
  broadcastId: string;
  userId: string;
  /** 取り出し時点までに「送れないまま終わった」回数（この取り出しぶんを含む） */
  attempts: number;
  /** 一時的な失敗で見送った回数（バックオフの段数） */
  deferrals: number;
}

/** メールの送信状況カウンタを1件ぶん動かす SQL（遷移と同じ batch に入れて使う） */
function moveCounter(from: string, to: string): string {
  return `UPDATE event_broadcast
             SET email_${from} = MAX(0, email_${from} - 1),
                 email_${to} = email_${to} + 1
           WHERE id = ?`;
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

  /** 通知の一括作成が途中で失敗したことを記録し、実際に作れた人数へ直す */
  async markIncomplete(id: string, delivered: number): Promise<void> {
    await run(
      "UPDATE event_broadcast SET incomplete = 1, recipient_count = ? WHERE id = ?",
      delivered,
      id,
    );
  },

  /** そのイベントの連絡かどうか（他のイベントの連絡を操作させないため） */
  async existsInEvent(broadcastId: string, eventId: string): Promise<boolean> {
    const row = await one<{ id: string }>(
      "SELECT id FROM event_broadcast WHERE id = ? AND event_id = ?",
      broadcastId,
      eventId,
    );
    return row !== null;
  },

  /** メールの送信待ちを積む。1人1行。D1 の書き込みをまとめるため分割して batch */
  async queueEmails(broadcastId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const now = Date.now();
    const CHUNK = 50;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      await batch(
        userIds.slice(i, i + CHUNK).map((userId) => ({
          sql: `INSERT INTO event_broadcast_email
                  (id, broadcast_id, user_id, status, attempts, next_attempt_at, created_at)
                VALUES (?, ?, ?, 'pending', 0, 0, ?)`,
          args: [crypto.randomUUID(), broadcastId, userId, now],
        })),
      );
    }
    await run(
      "UPDATE event_broadcast SET email_pending = email_pending + ? WHERE id = ?",
      userIds.length,
      broadcastId,
    );
  },

  /**
   * まだ送り終わっていない連絡を古い順に引く。
   *
   * 送信待ちの行そのものを古い順に引くと、送信待ちを大量に抱えた連絡が全部
   * 掃けるまで、後から出した別イベントの連絡が1通も送られない。連絡の単位で
   * 拾って枠を分け合えるように、まず「連絡」を引く。
   * email_pending > 0 の部分インデックスが効くので読み取りは処理中のぶんだけ。
   */
  async pendingBroadcasts(limit: number): Promise<PendingBroadcast[]> {
    const rows = await many<{
      id: string;
      event_id: string;
      title: string;
      body: string;
    }>(
      `SELECT id, event_id, title, body
         FROM event_broadcast
        WHERE email_pending > 0
        ORDER BY created_at ASC
        LIMIT ?`,
      limit,
    );
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      title: r.title,
      body: r.body,
    }));
  },

  /**
   * 送信待ちを取り出して自分のぶんにする（pending → sending）。
   *
   * 倒せた行だけを返すので、定期実行と送信直後のその場消化が重なっても
   * 同じ人へ2通送らない。
   */
  async claimEmails(
    broadcastId: string,
    limit: number,
    now: number,
  ): Promise<ClaimedBroadcastEmail[]> {
    if (limit <= 0) return [];
    const rows = await many<{
      id: string;
      user_id: string;
      attempts: number;
      deferrals: number;
    }>(
      `UPDATE event_broadcast_email
          SET status = 'sending', attempts = attempts + 1, claimed_at = ?
        WHERE id IN (
                SELECT id FROM event_broadcast_email
                 WHERE broadcast_id = ? AND status = 'pending' AND next_attempt_at <= ?
                 ORDER BY created_at ASC
                 LIMIT ?)
        RETURNING id, user_id, attempts, deferrals`,
      now,
      broadcastId,
      now,
      limit,
    );
    return rows.map((r) => ({
      id: r.id,
      broadcastId,
      userId: r.user_id,
      attempts: r.attempts,
      deferrals: r.deferrals,
    }));
  },

  /**
   * 実行が落ちて sending のまま残った行を送信待ちに戻す。
   * 取り出しのときに attempts を1つ消費しているので、繰り返し落ちる行は
   * いずれ上限に達して failed に倒れる（無限に拾い直さない）。
   */
  async reclaimStuckEmails(
    broadcastId: string,
    claimedBefore: number,
  ): Promise<number> {
    return runCount(
      `UPDATE event_broadcast_email
          SET status = 'pending', claimed_at = NULL
        WHERE broadcast_id = ? AND status = 'sending' AND claimed_at <= ?`,
      broadcastId,
      claimedBefore,
    );
  },

  async markEmailSent(id: string, broadcastId: string): Promise<void> {
    await batch([
      {
        sql: "UPDATE event_broadcast_email SET status = 'sent', claimed_at = NULL, sent_at = ? WHERE id = ?",
        args: [Date.now(), id],
      },
      { sql: moveCounter("pending", "sent"), args: [broadcastId] },
    ]);
  },

  /** 送信の直前に対象外と分かった（メール通知オフ・宛先なし・退会申請中） */
  async markEmailSkipped(id: string, broadcastId: string): Promise<void> {
    await batch([
      {
        sql: "UPDATE event_broadcast_email SET status = 'skipped', claimed_at = NULL WHERE id = ?",
        args: [id],
      },
      { sql: moveCounter("pending", "skipped"), args: [broadcastId] },
    ]);
  },

  /** これ以上ためしても送れない（宛先不正・試行回数の上限） */
  async markEmailFailed(id: string, broadcastId: string): Promise<void> {
    await batch([
      {
        sql: "UPDATE event_broadcast_email SET status = 'failed', claimed_at = NULL WHERE id = ?",
        args: [id],
      },
      { sql: moveCounter("pending", "failed"), args: [broadcastId] },
    ]);
  },

  /**
   * 一時的な失敗。試行回数は消費させずに次回の試行を後ろへずらす。
   * メール配信側の障害が続いても、その場で送信待ちを全滅させない
   */
  async deferEmail(id: string, nextAttemptAt: number): Promise<void> {
    await run(
      `UPDATE event_broadcast_email
          SET status = 'pending', attempts = MAX(0, attempts - 1),
              deferrals = deferrals + 1, next_attempt_at = ?, claimed_at = NULL
        WHERE id = ?`,
      nextAttemptAt,
      id,
    );
  },

  /**
   * 送信中に想定外の例外で落ちた。試行回数は消費させたまま送信待ちに戻す
   * （繰り返し落ちる行はいずれ上限に達して failed に倒れる）
   */
  async requeueEmail(id: string, nextAttemptAt: number): Promise<void> {
    await run(
      `UPDATE event_broadcast_email
          SET status = 'pending', next_attempt_at = ?, claimed_at = NULL
        WHERE id = ?`,
      nextAttemptAt,
      id,
    );
  },

  /** 取り出したが送信予算が尽きて手を付けられなかった。そのまま送信待ちに戻す */
  async releaseEmail(id: string): Promise<void> {
    await run(
      `UPDATE event_broadcast_email
          SET status = 'pending', attempts = MAX(0, attempts - 1), claimed_at = NULL
        WHERE id = ? AND status = 'sending'`,
      id,
    );
  },

  /**
   * 失敗したぶんを送信待ちに戻す（スタッフの操作）。
   * 試行回数・バックオフもリセットして、直った後にすぐ送れるようにする。
   * 戻した件数を返す
   */
  async requeueFailedEmails(broadcastId: string): Promise<number> {
    // 他の遷移と違い、戻す件数が実行するまで分からないので差分では書けない。
    // 行の更新とカウンタの更新を別々の文にすると、後者が落ちたときにカウンタが
    // ズレたまま残り、画面が「失敗◯件」と嘘をつき続ける。件数を数え直す形にして
    // 同じ batch（＝同一トランザクション）に入れ、ズレる経路自体を無くす。
    // スタッフが押したときだけ走る操作なので、数え直しの費用は問題にならない。
    const [moved] = await batch([
      {
        sql: `UPDATE event_broadcast_email
                 SET status = 'pending', attempts = 0, deferrals = 0,
                     next_attempt_at = 0, claimed_at = NULL
               WHERE broadcast_id = ? AND status = 'failed'`,
        args: [broadcastId],
      },
      {
        sql: `UPDATE event_broadcast
                 SET email_pending = (SELECT COUNT(1) FROM event_broadcast_email
                                       WHERE broadcast_id = ?
                                         AND status IN ('pending', 'sending')),
                     email_failed = (SELECT COUNT(1) FROM event_broadcast_email
                                      WHERE broadcast_id = ? AND status = 'failed')
               WHERE id = ?`,
        args: [broadcastId, broadcastId, broadcastId],
      },
    ]);
    return moved;
  },

  /** 送信履歴（新しい順）。メールの送信状況はカウンタ列から読む（集計しない） */
  async listByEvent(eventId: string, limit = 50): Promise<EventBroadcast[]> {
    const rows = await many<BroadcastRow>(
      `SELECT b.id, b.segment, b.title, b.body, b.recipient_count, b.incomplete,
              b.created_at, b.email_pending, b.email_sent, b.email_failed,
              b.email_skipped,
              COALESCE(u.global_name, u.username) AS sender_name
         FROM event_broadcast b
         LEFT JOIN user u ON u.id = b.created_by
        WHERE b.event_id = ?
        ORDER BY b.created_at DESC
        LIMIT ?`,
      eventId,
      limit,
    );
    return rows.map(toBroadcast);
  },

  /** 1件ぶんのメール送信状況（送信直後の応答・テストの検証に使う） */
  async emailStats(broadcastId: string): Promise<BroadcastEmailStats> {
    const row = await one<{
      email_pending: number;
      email_sent: number;
      email_failed: number;
      email_skipped: number;
    }>(
      `SELECT email_pending, email_sent, email_failed, email_skipped
         FROM event_broadcast WHERE id = ?`,
      broadcastId,
    );
    return {
      pending: row?.email_pending ?? 0,
      sent: row?.email_sent ?? 0,
      failed: row?.email_failed ?? 0,
      skipped: row?.email_skipped ?? 0,
    };
  },
};
