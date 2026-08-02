import { emailRepo } from "../db/repositories/email.js";
import { sendNotificationEmailTo } from "./email.js";
import { venueText } from "./emailTemplates.js";

/** 前日リマインダーメール (#126)。cron（毎日 UTC 0:00 = JST 9:00）から呼ばれる */

/** 1回の実行での送信上限（サブリクエスト数の安全上限） */
// 1通あたり最大~5サブリクエスト（Resend+D1）になったため、上限は控えめに維持する。
// 引き上げる場合は Workers のサブリクエスト上限（有料1000/リクエスト）に注意
const MAX_SENDS_PER_RUN = 200;

/** JST の開始時刻表記（例: 2026/8/4 19:00） */
function startText(ms: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

/** 24時間以内に開催されるイベントの参加者へ前日リマインダーを送る。
 * 対象: メール通知ON・検証済みメール有り・未送信の confirmed メンバー */
export async function sendEventReminders(now = Date.now()): Promise<number> {
  const targets = await emailRepo.listReminderTargets(now, MAX_SENDS_PER_RUN);
  let sent = 0;
  for (const t of targets) {
    try {
      const ok = await sendNotificationEmailTo(
        t.userId,
        t.email,
        `明日開催:「${t.title}」`,
        `${startText(t.startsAt)} 開始 ／ ${venueText(t.venueType, t.venueOffline)}`,
        `/events/${t.eventId}`,
        // リマインダーはイベントカードに加えてタイムテーブルも載せる (#134)
        { timetable: true },
      );
      if (ok) {
        await emailRepo.markReminderSent(t.memberId);
        sent++;
      }
    } catch (e) {
      console.warn(`reminder: 送信失敗 member=${t.memberId}`, e);
    }
  }
  console.log(`reminder: 対象 ${targets.length} 件中 ${sent} 件送信`);
  return sent;
}
