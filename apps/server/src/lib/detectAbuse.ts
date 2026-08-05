import {
  ABUSE_FLAG_COOLDOWN_MS,
  ABUSE_FLAG_RETENTION_MS,
  ABUSE_RULE_LABELS,
  ABUSE_RULES,
  ABUSE_THRESHOLDS as T,
  type AbuseRule,
  type DetectAbuseResult,
} from "@eventer/shared";
import { many, one } from "../db/client.js";
import {
  abuseFlagKey,
  abuseFlagsRepo,
  type AbuseFlagInput,
} from "../db/repositories/abuseFlags.js";
import { notificationsRepo } from "../db/repositories/notifications.js";
import { usersRepo } from "../db/repositories/users.js";
import { env } from "../runtime.js";

/** 異常行動の検知バッチ (#259 PR2)。
 * GitHub Actions の定時実行から POST /api/cron/detect-abuse 経由で呼ばれる
 * （Workers Free は cron トリガーがアカウント5個上限のため。#129 と同じ方式）。
 *
 * ■ 設計方針
 * - 自動制限はしない。引っかかったものを abuse_flag に記録し、運営に1通だけ通知する
 * - **ルールごとに1クエリ**。Workers のサブリクエスト上限(1リクエスト50)に対し、
 *   ルール7本 ＋ 重複判定1 ＋ 掃除1 ＋ INSERT(batch)1 ＋ 通知3 = 通常13本に収まる
 *   （検知が50件を超えると INSERT の batch が1本増える。メール通知ONの管理者への
 *    送信は waitUntil の中で追加のサブリクエストを使うが、管理者は数人なので無視できる。
 *    ルールを増やすときはこの見積もりを更新すること）
 * - **1ルールの失敗が他を止めない**。ルールごとに try/catch し、失敗は failedRules で返す
 * - 退会申請中 (deleted_at) のユーザーは全ルールで対象外
 * - detail に入れるのは件数・日付・割合だけ。メール・本文などの個人情報は入れない */

/** epoch ms のカラムを JST の 'YYYY-MM-DD' に。既存の集計 (kpi.ts) と同じ基準 */
function jd(col: string): string {
  return `strftime('%Y-%m-%d', ${col} / 1000 + 32400, 'unixepoch')`;
}

/** JST の 'YYYY-MM-DD' */
function jstDay(at: number): string {
  return new Date(at + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const DAY_MS = 86400000;

/** 小数を見やすい桁数に丸める（detail は表示用なので有効数字2桁で十分） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ルールの評価結果。subjectUserId が null ならサービス全体の異常 */
type Candidate = Omit<AbuseFlagInput, "rule">;

/** 消費した D1 クエリ本数のカウンタ。例外で途中終了しても消費済みが残るよう
 * 戻り値ではなく参照渡しで加算する（purgeDeleted.ts の Budget と同じ考え方） */
interface QueryCount {
  n: number;
}

interface UserRuleRow {
  user_id: string;
  handle: string;
}

/** イベントの大量作成: 24時間で shortMin 件以上 **または** 7日で longMin 件以上。
 * 下書きも含めて数える（公開前に大量生成されている時点で要確認のため） */
async function detectEventBurst(now: number, q: QueryCount): Promise<Candidate[]> {
  const { shortWindowMs, shortMin, longWindowMs, longMin } = T.eventBurst;
  q.n += 1;
  const rows = await many<UserRuleRow & { day_count: number; week_count: number }>(
    `SELECT e.created_by AS user_id, u.username AS handle,
            COALESCE(SUM(CASE WHEN e.created_at >= ? THEN 1 ELSE 0 END), 0) AS day_count,
            COUNT(1) AS week_count
       FROM event e JOIN user u ON u.id = e.created_by
      WHERE e.created_at >= ? AND u.deleted_at IS NULL
      GROUP BY e.created_by
     HAVING day_count >= ? OR week_count >= ?`,
    now - shortWindowMs,
    now - longWindowMs,
    shortMin,
    longMin,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: {
      dayCount: r.day_count,
      weekCount: r.week_count,
      windowDays: Math.round(longWindowMs / DAY_MS),
    },
  }));
}

/** たまご（イベントリクエスト）の大量投稿: 24時間で min 件以上 */
async function detectEggBurst(now: number, q: QueryCount): Promise<Candidate[]> {
  const { windowMs, min } = T.eggBurst;
  q.n += 1;
  const rows = await many<UserRuleRow & { n: number }>(
    `SELECT r.created_by AS user_id, u.username AS handle, COUNT(1) AS n
       FROM event_request r JOIN user u ON u.id = r.created_by
      WHERE r.created_at >= ? AND u.deleted_at IS NULL
      GROUP BY r.created_by
     HAVING COUNT(1) >= ?`,
    now - windowMs,
    min,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: { count: r.n, windowHours: Math.round(windowMs / 3600000) },
  }));
}

/** コメント・いいねの連投: 1時間あたり min 件以上。
 * 日次バッチなので「直近1時間」だけ見ると取りこぼす。lookbackMs の範囲を
 * windowMs 幅の固定バケットに割り、最大のバケットで判定する */
async function detectCommentBurst(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { windowMs, lookbackMs, min } = T.commentBurst;
  const since = now - lookbackMs;
  q.n += 1;
  const rows = await many<UserRuleRow & { n: number; total: number }>(
    `WITH acts AS (
       SELECT user_id AS uid, created_at AS at FROM event_comment WHERE created_at >= ?
       UNION ALL
       SELECT user_id AS uid, created_at AS at FROM event_like WHERE created_at >= ?
     ),
     buckets AS (
       -- CAST を挟むのは、バインドされた数値が REAL 扱いになると割り算が浮動小数に
       -- なってしまい、1msごとに別バケットへ散る（＝永久に発火しない）ため
       SELECT uid, CAST(at / ? AS INTEGER) AS bucket, COUNT(1) AS n
         FROM acts GROUP BY uid, bucket
     )
     SELECT b.uid AS user_id, u.username AS handle,
            MAX(b.n) AS n, COALESCE(SUM(b.n), 0) AS total
       FROM buckets b JOIN user u ON u.id = b.uid
      WHERE u.deleted_at IS NULL
      GROUP BY b.uid
     HAVING MAX(b.n) >= ?`,
    since,
    since,
    windowMs,
    min,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: {
      perHour: r.n,
      count: r.total,
      windowHours: Math.round(lookbackMs / 3600000),
    },
  }));
}

/** 新規アカウントの即時大量行動: 登録から withinMs 以内にイベント作成 min 件以上。
 * 対象は lookbackMs 以内に登録したユーザーだけ（古い新規を毎日見直さない） */
async function detectNewAccountBurst(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { withinMs, min, lookbackMs } = T.newAccountBurst;
  q.n += 1;
  const rows = await many<UserRuleRow & { n: number }>(
    `SELECT u.id AS user_id, u.username AS handle, COUNT(1) AS n
       FROM user u JOIN event e
         ON e.created_by = u.id AND e.created_at <= u.created_at + ?
      WHERE u.created_at >= ? AND u.deleted_at IS NULL
      GROUP BY u.id
     HAVING COUNT(1) >= ?`,
    withinMs,
    now - lookbackMs,
    min,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: { count: r.n, windowHours: Math.round(withinMs / 3600000) },
  }));
}

/** 参加者0のイベント量産: 直近 windowMs に作成した公開イベントのうち
 * 参加者0が min 件以上。参加者は主催・スタッフ行 (role='staff') を除いた確定者
 * （イベント作成時に作成者の staff 行が必ず作られるため、除かないと常に1人になる） */
async function detectEmptyEventSpam(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { windowMs, min } = T.emptyEventSpam;
  q.n += 1;
  const rows = await many<UserRuleRow & { empty: number; total: number }>(
    `SELECT e.created_by AS user_id, u.username AS handle,
            COALESCE(SUM(CASE WHEN NOT EXISTS (
              SELECT 1 FROM event_member m
               WHERE m.event_id = e.id AND m.role <> 'staff' AND m.status = 'confirmed'
            ) THEN 1 ELSE 0 END), 0) AS empty,
            COUNT(1) AS total
       FROM event e JOIN user u ON u.id = e.created_by
      WHERE e.created_at >= ? AND e.status = 'published' AND u.deleted_at IS NULL
      GROUP BY e.created_by
     HAVING empty >= ?`,
    now - windowMs,
    min,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: {
      emptyEvents: r.empty,
      createdEvents: r.total,
      windowDays: Math.round(windowMs / DAY_MS),
    },
  }));
}

/** 大量キャンセル: 期間内のキャンセルが min 件以上 **かつ** 率が minRate 以上。
 * 母数は同じ期間に作成された参加登録（主催・スタッフ行と下書きイベントは除く。
 * 日程調整中の取消 canceled_scheduling は KPI と同様に数えない） */
async function detectCancelBurst(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { windowMs, min, minRate } = T.cancelBurst;
  q.n += 1;
  const rows = await many<UserRuleRow & { canceled: number; total: number }>(
    `SELECT m.user_id AS user_id, u.username AS handle,
            COALESCE(SUM(CASE WHEN m.status = 'canceled' AND m.canceled_scheduling = 0
                              THEN 1 ELSE 0 END), 0) AS canceled,
            COUNT(1) AS total
       FROM event_member m
       JOIN event e ON e.id = m.event_id
       JOIN user u ON u.id = m.user_id
      WHERE m.created_at >= ? AND m.role <> 'staff'
        AND e.status = 'published' AND u.deleted_at IS NULL
      GROUP BY m.user_id
     HAVING canceled >= ? AND (canceled * 1.0 / total) >= ?`,
    now - windowMs,
    min,
    minRate,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: {
      canceled: r.canceled,
      registrations: r.total,
      cancelRate: round2(r.canceled / r.total),
      windowDays: Math.round(windowMs / DAY_MS),
    },
  }));
}

/** 全体の登録急増: 直近の「完了した1日」(JST) の新規登録が、その前の
 * baselineDays 日の平均の ratio 倍以上 **かつ** min 件以上。
 * 特定ユーザーの話ではないので subject_user_id は NULL */
async function detectSignupSpike(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { baselineDays, ratio, min } = T.signupSpike;
  // バッチは JST 深夜に走る前提。当日はまだ途中なので「昨日」を対象にする
  const targetDay = jstDay(now - DAY_MS);
  const baselineFrom = jstDay(now - DAY_MS - baselineDays * DAY_MS);
  q.n += 1;
  const row = await one<{ target_count: number; baseline_count: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN d = ? THEN 1 ELSE 0 END), 0) AS target_count,
       COALESCE(SUM(CASE WHEN d >= ? AND d < ? THEN 1 ELSE 0 END), 0) AS baseline_count
     FROM (SELECT ${jd("created_at")} AS d FROM user
            WHERE deleted_at IS NULL AND created_at >= ?)`,
    targetDay,
    baselineFrom,
    targetDay,
    now - (baselineDays + 2) * DAY_MS,
  );
  const signups = row?.target_count ?? 0;
  const baselineAvg = (row?.baseline_count ?? 0) / baselineDays;
  if (signups < min) return [];
  if (signups < baselineAvg * ratio) return [];
  return [
    {
      subjectUserId: null,
      subjectHandle: "",
      detail: {
        day: targetDay,
        signups,
        baselineAvg: round2(baselineAvg),
        ratio: baselineAvg > 0 ? round2(signups / baselineAvg) : null,
      },
    },
  ];
}

const DETECTORS: Record<
  AbuseRule,
  (now: number, q: QueryCount) => Promise<Candidate[]>
> = {
  event_burst: detectEventBurst,
  egg_burst: detectEggBurst,
  comment_burst: detectCommentBurst,
  new_account_burst: detectNewAccountBurst,
  empty_event_spam: detectEmptyEventSpam,
  cancel_burst: detectCancelBurst,
  signup_spike: detectSignupSpike,
};

/** 新規に記録したフラグを運営管理者のベルへ通知する。
 * **1回のバッチで1通**にまとめる（ルールごとに何件、のサマリ）。
 * 通知の失敗で検知結果を失わないよう、呼び出し側で握りつぶす */
async function notifyAdmins(
  byRule: Record<string, number>,
  recorded: number,
  q: QueryCount,
): Promise<number> {
  q.n += 1;
  const adminIds = await usersRepo.listIdsByDiscordIds(env.adminDiscordIds);
  if (adminIds.length === 0) return 0;
  const lines = ABUSE_RULES.filter((r) => (byRule[r] ?? 0) > 0).map(
    (r) => `${ABUSE_RULE_LABELS[r]}: ${byRule[r]}件`,
  );
  // INSERT の batch 1本 ＋ メール対象の抽出 1本（送信自体は waitUntil の中）
  q.n += 2;
  await notificationsRepo.createForMany(
    adminIds,
    "abuse_flag",
    `要確認の検知が ${recorded} 件あります`,
    lines.join(" / "),
    "/admin/abuse",
  );
  return adminIds.length;
}

export async function detectAbuse(): Promise<DetectAbuseResult> {
  const now = Date.now();
  const q: QueryCount = { n: 0 };
  const failedRules: string[] = [];

  // 重複抑制の判定材料を先に1クエリでまとめて取る
  q.n += 1;
  const recent = await abuseFlagsRepo.recentKeys(now - ABUSE_FLAG_COOLDOWN_MS);

  const toRecord: AbuseFlagInput[] = [];
  const byRule: Record<string, number> = {};
  let skipped = 0;

  for (const rule of ABUSE_RULES) {
    byRule[rule] = 0;
    try {
      const candidates = await DETECTORS[rule](now, q);
      for (const cand of candidates) {
        const key = abuseFlagKey(rule, cand.subjectUserId);
        // クールダウン期間内に既に記録があればスキップ。同じバッチ内の重複も
        // ここで潰れるよう、記録予定のキーも recent に足していく
        if (recent.has(key)) {
          skipped += 1;
          continue;
        }
        recent.add(key);
        toRecord.push({ rule, ...cand });
        byRule[rule] += 1;
      }
    } catch (e) {
      // 1ルールの失敗で他のルールを止めない
      failedRules.push(rule);
      console.error(`[abuse] rule ${rule} failed`, e);
    }
  }

  if (toRecord.length > 0) {
    q.n += Math.ceil(toRecord.length / 50);
    await abuseFlagsRepo.recordMany(toRecord, now);
  }

  // 保存期間切れの掃除（監査ログ #248 と同じ方針）
  try {
    q.n += 1;
    await abuseFlagsRepo.purgeOlderThan(now - ABUSE_FLAG_RETENTION_MS);
  } catch (e) {
    console.error("[abuse] retention purge failed", e);
  }

  let notified = 0;
  if (toRecord.length > 0) {
    try {
      notified = await notifyAdmins(byRule, toRecord.length, q);
    } catch (e) {
      // 通知に失敗しても記録は済んでいるので、バッチ自体は成功扱いにする
      console.error("[abuse] admin notification failed", e);
    }
  }

  return {
    recorded: toRecord.length,
    skipped,
    byRule,
    failedRules,
    notified,
    queries: q.n,
  };
}
