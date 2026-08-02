import { emailRepo, type ReminderTarget } from "../db/repositories/email.js";
import { sendNotificationEmailTo } from "./email.js";

/** 前日リマインダーメール (#126)。cron（毎日 UTC 0:00 = JST 9:00）から呼ばれる */

/** 1回の実行での送信上限（サブリクエスト数の安全上限） */
const MAX_SENDS_PER_RUN = 200;

const VENUE_LABEL: Record<string, string> = {
  offline: "オフライン",
  online: "オンライン",
  hybrid: "ハイブリッド",
};

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

/** 会場ラベル（オフラインは場所名、オンラインは種別のみ。URLは載せずリンク先で確認） */
function venueText(t: ReminderTarget): string {
  const label = VENUE_LABEL[t.venueType] ?? t.venueType;
  if (t.venueType !== "online" && t.venueOffline) {
    return `${label}（${t.venueOffline}）`;
  }
  return label;
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
        `${startText(t.startsAt)} 開始 ／ ${venueText(t)}`,
        `/events/${t.eventId}`,
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
