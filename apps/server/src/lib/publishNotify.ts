import type { Event } from "@eventer/shared";
import { notifyRequestsOnPublish } from "../routes/eventRequests.js";
import { notifyFollowersOnPublish } from "../routes/follows.js";

/**
 * 公開になったときの通知。**PATCH・POST /publish・予約公開（lib/scheduledPublish.ts）の
 * すべてがここを通る**。
 *
 * 別々に書くと必ずずれる（たまごの賛同者には届くのにフォロワーには届かない、
 * 片方だけ何度も通知する、など）。フォロワーへの公開通知は draft→published の
 * 実遷移のときだけ・初回だけに絞りたいので、`prior` の状態もここで見る。
 */
export async function notifyOnPublish(
  prior: Event | null,
  event: Event,
): Promise<void> {
  // たまご（あったらいいな）にリンク済みなら公開時に賛同者へ通知
  await notifyRequestsOnPublish(event);
  // 作成者のフォロワーへ公開通知（draft→published の実遷移時のみ・初回のみ）
  if (prior?.status !== "published" || prior?.visibility !== "public") {
    await notifyFollowersOnPublish(event);
  }
}
