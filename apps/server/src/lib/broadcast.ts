import type { BroadcastSegment } from "@eventer/shared";
import { deferBackground, emailSlotsLeft, env } from "../runtime.js";
import { emailRepo } from "../db/repositories/email.js";
import { eventBroadcastsRepo } from "../db/repositories/eventBroadcasts.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { sendNotificationEmailTo } from "./email.js";

/**
 * 参加者への一斉連絡の配信 (#172)。
 *
 * アプリ内通知は送信時に作りきる（確実に届く）。メールは1リクエストで送れる件数に
 * 上限（runtime.ts の EMAIL_BUDGET_PER_REQUEST）があるため、宛先を1行ずつ積んで
 * 定期実行 (.github/workflows/broadcast-emails.yml) で順次消化する。
 */

/** 何回試しても送れなかったら「失敗」に倒す回数。
 * 一時的な失敗（Resend の 5xx 等）は次の定期実行で拾えるので数回は粘る */
const MAX_EMAIL_ATTEMPTS = 3;

/** アプリ内通知を作る人数の上限。イベント規模から見て現実的な上限を大きく超えたら
 * 打ち切る（D1 の書き込み量の暴走を防ぐ安全弁で、通常は到達しない） */
const MAX_RECIPIENTS = 5000;

export interface BroadcastResult {
  broadcastId: string;
  /** アプリ内通知を作った人数 */
  recipientCount: number;
  /** メールの送信待ちに積んだ件数 */
  emailQueued: number;
}

/**
 * 一斉連絡を送る。呼び出し元（ルート）で権限・回数上限を確認済みであること。
 *
 * 1. 区分から宛先を引く（退会申請中・退会済みは含まれない）
 * 2. 履歴を1件作る
 * 3. アプリ内通知を一括で作る（ここでメールは送らない）
 * 4. メール通知ONの人ぶんだけ送信待ちを積む
 * 5. レスポンスの外で、その場で送れるぶん（1リクエストの送信予算まで）を消化する
 */
export async function sendBroadcast(input: {
  eventId: string;
  actorUserId: string;
  segment: BroadcastSegment;
  title: string;
  body: string;
}): Promise<BroadcastResult> {
  const all = await eventBroadcastsRepo.recipientIds(
    input.eventId,
    input.segment,
  );
  const userIds = all.slice(0, MAX_RECIPIENTS);
  if (all.length > userIds.length) {
    console.warn(
      `broadcast: 宛先 ${all.length} 件のうち ${userIds.length} 件に打ち切り event=${input.eventId}`,
    );
  }

  const broadcastId = await eventBroadcastsRepo.create({
    eventId: input.eventId,
    createdBy: input.actorUserId,
    segment: input.segment,
    title: input.title,
    body: input.body,
    recipientCount: userIds.length,
  });

  if (userIds.length > 0) {
    await notificationsRepo.createForMany(
      userIds,
      "event_broadcast",
      input.title,
      input.body,
      `/events/${input.eventId}`,
      undefined,
      // メールは下で送信待ちに積む。ここで送ると上限で静かに打ち切られ、
      // 誰に届いていないかも残らない
      { skipEmail: true },
    );
  }

  // 積む時点でメール通知OFF・アドレス無しの人は最初から対象にしない。
  // 「送信待ち」の件数が実際に届く見込みの数になり、画面の意味が合う
  const recipients = await emailRepo.findRecipientsAmong(userIds);
  const emailUserIds = recipients.map((r) => r.userId);
  if (emailUserIds.length > 0) {
    await eventBroadcastsRepo.queueEmails(broadcastId, emailUserIds);
    // 少人数のイベントならこの場で送りきれる。送れなかったぶんは定期実行が拾う
    await deferBackground(drainBroadcastEmails());
  }

  return {
    broadcastId,
    recipientCount: userIds.length,
    emailQueued: emailUserIds.length,
  };
}

export interface DrainResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * メールの送信待ちを古い順に消化する。
 *
 * 取り出す件数を「1リクエストに残っている送信予算」に合わせるのが要点。
 * 予算を超えて取り出すと sendNotificationEmailTo が送らずに false を返し、
 * 実際には壊れていないのに失敗回数だけが積み上がってしまう。
 */
export async function drainBroadcastEmails(): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, failed: 0, skipped: 0 };
  // メール送信が設定されていないなら何もしない。ここで送ろうとすると全件が
  // 「失敗」になり、設定を直しても送り直せなくなる（送信待ちのまま置いておく）
  if (!env.resendApiKey) return out;
  const rows = await eventBroadcastsRepo.listPendingEmails(emailSlotsLeft());
  for (const row of rows) {
    // 予算はイベントカードの取得など他の処理でも減りうるので毎回見る
    if (emailSlotsLeft() <= 0) break;
    try {
      // 送信の直前に宛先を引き直す。積んだ後にメール通知をオフにした人や
      // 退会申請 (#250) をした人には送らない
      const to = await emailRepo.findRecipient(row.userId);
      if (!to) {
        await eventBroadcastsRepo.markEmailSkipped(row.id);
        out.skipped++;
        continue;
      }
      const ok = await sendNotificationEmailTo(
        row.userId,
        to,
        row.title,
        row.body,
        `/events/${row.eventId}`,
      );
      if (ok) {
        await eventBroadcastsRepo.markEmailSent(row.id);
        out.sent++;
      } else {
        await eventBroadcastsRepo.markEmailAttemptFailed(
          row.id,
          MAX_EMAIL_ATTEMPTS,
        );
        out.failed++;
      }
    } catch (e) {
      console.warn(`broadcast: メール送信に失敗 queue=${row.id}`, e);
      await eventBroadcastsRepo.markEmailAttemptFailed(
        row.id,
        MAX_EMAIL_ATTEMPTS,
      );
      out.failed++;
    }
  }
  if (rows.length > 0) {
    console.log(
      `broadcast: 送信待ち ${rows.length} 件を処理（送信 ${out.sent} / 失敗 ${out.failed} / 対象外 ${out.skipped}）`,
    );
  }
  return out;
}
