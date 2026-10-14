import { many } from "../db/client.js";
import { eventsRepo } from "../db/repositories/events.js";
import { eventSignal } from "./eventSignal.js";
import { notifyOnPublish } from "./publishNotify.js";

/**
 * 予約公開の時刻を過ぎた下書きを公開する (D-EVENT-SCHEDULED-PUBLISH)。
 *
 * 呼ぶのは2か所だけ：本番の cron-hub から Service Binding 経由の
 * `CronEntrypoint.publishDueEvents()`（1分ごと）と、app admin の手動実行
 * `POST /api/admin/run-scheduled-publish`（staging の確かめ用）。
 *
 * 1回だけを守るのは UPDATE … RETURNING の1文（設計 §3.4）。実行が重なっても、
 * 行を変えた側だけが id を受け取るので、通知が2回走ることはない。
 * 手動の公開は同じ UPDATE の中で publish_at を NULL に戻すので、ここの条件に当たらない。
 */
export async function publishDueEvents(
  now = Date.now(),
): Promise<{ published: string[] }> {
  const rows = await many<{ id: string }>(
    `UPDATE event SET status = 'published', publish_at = NULL, access_revision = access_revision + 1
      WHERE publish_at IS NOT NULL AND publish_at <= ? AND status = 'draft'
      RETURNING id`,
    now,
  );
  const published = rows.map((row) => row.id);
  for (const id of published) {
    // 公開はもう終わっている。通知の失敗で状態は戻さず、ほかのイベントは続ける
    // （手動の公開で通知が失敗したときと同じ扱い）
    try {
      await runPublishSideEffects(id);
    } catch (error) {
      console.error(`[scheduled-publish] side effects failed event=${id}`, error);
    }
  }
  return { published };
}

/** 手動で公開したときと同じ通知と「取り直して」シグナルを出す */
async function runPublishSideEffects(id: string): Promise<void> {
  const event = await eventsRepo.findById(id);
  if (!event) return;
  await notifyOnPublish({ ...event, status: "draft" }, event);
  await eventSignal.publishRefetch([["live", id]]);
}
