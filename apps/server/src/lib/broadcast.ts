import type { BroadcastSegment } from "@eventer/shared";
import { deferBackground, emailSlotsLeft, env } from "../runtime.js";
import { emailRepo } from "../db/repositories/email.js";
import {
  eventBroadcastsRepo,
  type ClaimedBroadcastEmail,
} from "../db/repositories/eventBroadcasts.js";
import {
  notificationsRepo,
  PartialNotificationError,
} from "../db/repositories/notifications.js";
import { sendNotificationEmailToWithOutcome } from "./email.js";

/**
 * 参加者への一斉連絡の配信 (#172)。
 *
 * アプリ内通知は送信時に作りきる（確実に届く）。メールは1リクエストで送れる件数に
 * 上限（runtime.ts の EMAIL_BUDGET_PER_REQUEST）があるため、宛先を1行ずつ積んで
 * 定期実行 (.github/workflows/broadcast-emails.yml) で順次消化する。
 */

/**
 * 「送れないまま終わった」回数の上限。ここに達したら failed に倒す。
 *
 * レート超過・5xx・通信エラーのような**直る見込みのある失敗ではこの回数を消費しない**
 * （下の BACKOFF_MS で間隔を空けて粘る）。消費するのは、宛先やペイロードが不正で
 * 何度ためしても同じ結果になる場合と、実行が途中で落ちて取り出したまま残った場合。
 * つまりこれは「壊れた行を無限に拾い直さない」ための数
 */
const MAX_EMAIL_ATTEMPTS = 3;

/**
 * 一時的な失敗のときに次の試行までどれだけ空けるか（deferrals 回目に対応）。
 * 最後の値を超えたぶんは最後の値を使い、MAX_DEFERRALS で打ち切る。
 * 合計でおよそ丸1日ぶん粘るので、メール配信側の障害が数時間続いても
 * 送信待ちが全滅しない（レビュー指摘: 15分の障害で全部 failed になっていた）
 */
const BACKOFF_MS = [
  5 * 60_000,
  10 * 60_000,
  20 * 60_000,
  40 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
];
/** 一時的な失敗で見送れる回数の上限。ここまで粘っても駄目なら failed に倒し、
 * スタッフが履歴から送り直せるようにする */
const MAX_DEFERRALS = 12;

/** sending のまま放置された行を拾い直すまでの時間。
 * 1回の実行が長引くことはないので、これを超えていれば実行が落ちたとみなす */
const STUCK_MS = 10 * 60_000;

/** 1回の消化で枠を分け合う連絡の数。送信待ちを大量に抱えた連絡があっても、
 * 後から出した別イベントの連絡が待たされ続けないようにするためのもの */
const MAX_BROADCASTS_PER_DRAIN = 4;

/** アプリ内通知を作る人数の上限。イベント規模から見て現実的な上限を大きく超えたら
 * 打ち切る（D1 の書き込み量の暴走を防ぐ安全弁で、通常は到達しない） */
export const MAX_RECIPIENTS = 5000;

export interface BroadcastResult {
  broadcastId: string;
  /** アプリ内通知を作れた人数 */
  recipientCount: number;
  /** メールの送信待ちに積んだ件数 */
  emailQueued: number;
  /** 通知の作成が途中で失敗した（区分の一部の人にしか届いていない） */
  incomplete: boolean;
  /** 打ち切った場合の、区分に該当した本来の人数。打ち切っていなければ null */
  truncatedFrom: number | null;
}

/**
 * 一斉連絡を送る。呼び出し元（ルート）で権限・回数上限を確認済みであること。
 *
 * 1. 区分から宛先を引く（退会申請中・退会済みは含まれない）
 * 2. 履歴を1件作る
 * 3. アプリ内通知を一括で作る（ここでメールは送らない）
 * 4. メール通知ONの人ぶんだけ送信待ちを積む
 * 5. レスポンスの外で、その場で送れるぶん（1リクエストの送信予算まで）を消化する
 *
 * 3 が途中で落ちた場合は、そこまでに届いたぶんを recipientCount として記録し
 * incomplete を立てて返す。全体を失敗にすると、画面が再送を促して同じ人に
 * 二重に届くため（1人も作れていないときだけ例外を投げ直す）。
 */
export async function sendBroadcast(
  input: {
    eventId: string;
    actorUserId: string;
    segment: BroadcastSegment;
    title: string;
    body: string;
  },
  opts: { maxRecipients?: number } = {},
): Promise<BroadcastResult> {
  const maxRecipients = opts.maxRecipients ?? MAX_RECIPIENTS;
  const all = await eventBroadcastsRepo.recipientIds(
    input.eventId,
    input.segment,
  );
  const userIds = all.slice(0, maxRecipients);
  const truncatedFrom = all.length > userIds.length ? all.length : null;
  if (truncatedFrom !== null) {
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

  let delivered = userIds;
  let incomplete = false;
  if (userIds.length > 0) {
    try {
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
    } catch (e) {
      // 1人も作れていないなら「送れなかった」で正しい。そのまま投げ直して
      // 画面には通常のエラー（時間をおいて再送）を出させる
      if (!(e instanceof PartialNotificationError) || e.delivered === 0) throw e;
      delivered = userIds.slice(0, e.delivered);
      incomplete = true;
      console.warn(
        `broadcast: 通知の一括作成が途中で失敗 broadcast=${broadcastId} delivered=${e.delivered}/${userIds.length}`,
        e.cause,
      );
      await eventBroadcastsRepo.markIncomplete(broadcastId, delivered.length);
    }
  }

  // 積む時点でメール通知OFF・アドレス無しの人は最初から対象にしない。
  // 「送信待ち」の件数が実際に届く見込みの数になり、画面の意味が合う。
  // アプリ内通知が届かなかった人にはメールも送らない（届いた人と揃える）
  const recipients = await emailRepo.findRecipientsAmong(delivered);
  const emailUserIds = recipients.map((r) => r.userId);
  if (emailUserIds.length > 0) {
    await eventBroadcastsRepo.queueEmails(broadcastId, emailUserIds);
    // 少人数のイベントならこの場で送りきれる。送れなかったぶんは定期実行が拾う
    await deferBackground(drainBroadcastEmails());
  }

  return {
    broadcastId,
    recipientCount: delivered.length,
    emailQueued: emailUserIds.length,
    incomplete,
    truncatedFrom,
  };
}

export interface DrainResult {
  sent: number;
  failed: number;
  skipped: number;
  /** 一時的な失敗で次回に見送ったぶん（失敗ではない） */
  deferred: number;
  /** 送信待ちから取り出した件数。送信予算を超えて取り出していないことの確認に使う
   * （取り出しすぎると、送る当てのない行を sending に倒しては戻すことになる） */
  claimed: number;
}

/**
 * メールの送信待ちを消化する。
 *
 * 取り出す件数を「1リクエストに残っている送信予算」に合わせるのが要点。
 * 予算を超えて取り出すと sendNotificationEmailTo が送らずに false を返し、
 * 実際には壊れていないのに送信待ちが余計に動いてしまう。
 *
 * 取り出しは「連絡ごとに枠を分け合う」形にしている。送信待ちの行を素直に古い順で
 * 引くと、数千件を抱えた連絡が掃け終わるまで、後から出した別イベントの緊急連絡が
 * 1通も送られない。連絡単位で拾えば、待っている連絡の数だけ枠を割って進む。
 */
export async function drainBroadcastEmails(): Promise<DrainResult> {
  const out: DrainResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    claimed: 0,
  };
  // メール送信が設定されていないなら何もしない。ここで送ろうとすると全件が
  // 送信待ちのまま attempts だけ動くので、触らずに置いておく
  if (!env.resendApiKey) return out;
  const budget = emailSlotsLeft();
  if (budget <= 0) return out;

  const broadcasts = await eventBroadcastsRepo.pendingBroadcasts(
    MAX_BROADCASTS_PER_DRAIN,
  );
  if (broadcasts.length === 0) return out;

  const now = Date.now();
  let taken = 0;
  const claimed: Array<{
    row: ClaimedBroadcastEmail;
    head: (typeof broadcasts)[number];
  }> = [];
  for (let i = 0; i < broadcasts.length; i++) {
    const head = broadcasts[i]!;
    const left = budget - taken;
    if (left <= 0) break;
    // 残りの枠を、残りの連絡で等分する。前の連絡が取らなかったぶん
    // （バックオフ中で1件も取れなかった等）は後ろの連絡に回る
    const share = Math.max(1, Math.ceil(left / (broadcasts.length - i)));
    // 実行が落ちて取り出したまま残った行を先に戻す（次の取り出しで拾える）
    await eventBroadcastsRepo.reclaimStuckEmails(head.id, now - STUCK_MS);
    const rows = await eventBroadcastsRepo.claimEmails(
      head.id,
      Math.min(share, left),
      now,
    );
    for (const row of rows) claimed.push({ row, head });
    taken += rows.length;
    out.claimed += rows.length;
  }

  for (let i = 0; i < claimed.length; i++) {
    const { row, head } = claimed[i]!;
    // 予算はイベントカードの取得など他の処理でも減りうるので毎回見る。
    // 取り出したまま手を付けられなかったぶんは送信待ちに戻す
    if (emailSlotsLeft() <= 0) {
      for (let j = i; j < claimed.length; j++) {
        await eventBroadcastsRepo.releaseEmail(claimed[j]!.row.id);
      }
      break;
    }
    try {
      // 送信の直前に宛先を引き直す。積んだ後にメール通知をオフにした人や
      // 退会申請 (#250) をした人には送らない
      const to = await emailRepo.findRecipient(row.userId);
      if (!to) {
        await eventBroadcastsRepo.markEmailSkipped(row.id, row.broadcastId);
        out.skipped++;
        continue;
      }
      const outcome = await sendNotificationEmailToWithOutcome(
        row.userId,
        to,
        head.title,
        head.body,
        `/events/${head.eventId}`,
      );
      if (outcome.ok) {
        await eventBroadcastsRepo.markEmailSent(row.id, row.broadcastId);
        out.sent++;
      } else if (outcome.retryable) {
        await deferOrFail(row, out);
      } else {
        // 宛先やペイロードが不正。同じ内容で送り直しても結果は変わらない
        await eventBroadcastsRepo.markEmailFailed(row.id, row.broadcastId);
        out.failed++;
      }
    } catch (e) {
      // 想定外の例外は一時的なものとして扱う（attempts は取り出し時に消費済みなので、
      // 繰り返し落ちる行はいずれ上限に達して failed に倒れる）
      console.warn(`broadcast: メール送信に失敗 queue=${row.id}`, e);
      await failIfExhausted(row, out);
    }
  }
  if (claimed.length > 0) {
    console.log(
      `broadcast: 送信待ち ${claimed.length} 件を処理（送信 ${out.sent} / 失敗 ${out.failed} / 対象外 ${out.skipped} / 見送り ${out.deferred}）`,
    );
  }
  return out;
}

/** 一時的な失敗。間隔を空けて送信待ちに戻す（粘りすぎたら失敗に倒す） */
async function deferOrFail(
  row: ClaimedBroadcastEmail,
  out: DrainResult,
): Promise<void> {
  if (row.deferrals >= MAX_DEFERRALS) {
    await eventBroadcastsRepo.markEmailFailed(row.id, row.broadcastId);
    out.failed++;
    return;
  }
  const wait = BACKOFF_MS[Math.min(row.deferrals, BACKOFF_MS.length - 1)]!;
  await eventBroadcastsRepo.deferEmail(row.id, Date.now() + wait);
  out.deferred++;
}

/** 例外で落ちたとき。取り出し時に消費した attempts が上限に達していたら失敗に倒す */
async function failIfExhausted(
  row: ClaimedBroadcastEmail,
  out: DrainResult,
): Promise<void> {
  if (row.attempts >= MAX_EMAIL_ATTEMPTS) {
    await eventBroadcastsRepo.markEmailFailed(row.id, row.broadcastId);
    out.failed++;
    return;
  }
  await eventBroadcastsRepo.requeueEmail(row.id, Date.now() + BACKOFF_MS[0]!);
  out.deferred++;
}
