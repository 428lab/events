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
  abuseAllowlistRepo,
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
 *   ルール7本 ＋ 重複判定1 ＋ 抑制リスト1 ＋ 掃除1 ＋ INSERT(batch)1 ＋ 通知3
 *   = 通常14本に収まる
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
 *
 * 日次バッチなので「直近1時間」だけ見ると取りこぼす。lookbackMs の範囲を
 * windowMs 幅の固定バケットに割り、最大のバケットで判定する。
 *
 * ■ バケット境界のずらし (#259 レビュー反映)
 * エポック基準の固定境界1系統だと、境界をまたぐ連投が2つに割れる。
 * 60秒に58件を境界の真上に投げると 29/29 になり、min=30 に **恒久的に**
 * 届かない（毎日同じように割れるので、いつまでも検知されない）。
 * そこで開始位置を windowMs/2 ずらした2系統目を作り、両系統の最大値で判定する。
 * どんな位相の連投でも、少なくとも片方の系統では 2/3 以上が同じバケットに入る。
 *
 * ■ いいねの数え方 (#259 レビュー反映)
 * event_like は1イベントにつき event / host / staff(人数分) / community と
 * 複数行できる。全部数えるとスタッフ4名のイベント8件にいいねしただけで32行になり、
 * 熱心な参加者が誤検知される。**1アクション1カウント**になるよう kind='event'
 * だけを数える（イベントへのいいねは1ユーザー1イベント1行）。 */
async function detectCommentBurst(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { windowMs, lookbackMs, min } = T.commentBurst;
  const since = now - lookbackMs;
  const halfWindowMs = Math.floor(windowMs / 2);
  q.n += 1;
  const rows = await many<UserRuleRow & { n: number; total: number }>(
    `WITH acts AS (
       SELECT user_id AS uid, created_at AS at FROM event_comment WHERE created_at >= ?
       UNION ALL
       SELECT user_id AS uid, created_at AS at FROM event_like
        WHERE created_at >= ? AND kind = 'event'
     ),
     -- CAST を挟むのは、バインドされた数値が REAL 扱いになると割り算が浮動小数に
     -- なってしまい、1msごとに別バケットへ散る（＝永久に発火しない）ため。
     -- phase 0 はエポック基準、phase 1 は windowMs/2 ずらした系統
     slots AS (
       SELECT uid, 0 AS phase, CAST(at / ? AS INTEGER) AS bucket FROM acts
       UNION ALL
       SELECT uid, 1 AS phase, CAST((at + ?) / ? AS INTEGER) AS bucket FROM acts
     ),
     counted AS (
       SELECT uid, phase, bucket, COUNT(1) AS n
         FROM slots GROUP BY uid, phase, bucket
     ),
     -- total は phase をまたぐと二重に数えてしまうので acts から別に取る
     totals AS (SELECT uid, COUNT(1) AS total FROM acts GROUP BY uid)
     SELECT c.uid AS user_id, u.username AS handle,
            MAX(c.n) AS n, MAX(t.total) AS total
       FROM counted c
       JOIN totals t ON t.uid = c.uid
       JOIN user u ON u.id = c.uid
      WHERE u.deleted_at IS NULL
      GROUP BY c.uid
     HAVING MAX(c.n) >= ?`,
    since,
    since,
    windowMs,
    halfWindowMs,
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
 * 対象は lookbackMs 以内に登録したユーザーだけ（古い新規を毎日見直さない）。
 *
 * e.created_at にも下限を置いているのは **インデックスを効かせるため**。
 * これが無いと SQLite は event を全件 SCAN する（実測 8ms・3万行読み取り）。
 * 対象ユーザーは lookbackMs 以内の登録、対象イベントはその登録から withinMs
 * 以内の作成なので、イベントの作成時刻は必ず now - (lookbackMs + withinMs)
 * 以降に入る。つまりこの下限は結果を変えず、idx_event_created_at が使えるようになる。
 * （event(created_by) のインデックスで代用しないのは、それを足すと
 *   event_burst の方が範囲検索から全件走査に化けるため。migration 0055 参照） */
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
      WHERE u.created_at >= ? AND e.created_at >= ? AND u.deleted_at IS NULL
      GROUP BY u.id
     HAVING COUNT(1) >= ?`,
    withinMs,
    now - lookbackMs,
    now - lookbackMs - withinMs,
    min,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: { count: r.n, windowHours: Math.round(withinMs / 3600000) },
  }));
}

/** 参加者0のイベント量産: 公開イベントのうち「誰も申し込んでいない」ものが
 * min 件以上。対象は作成から minAgeMs 〜 windowMs のイベント。
 *
 * ■ 作成時刻の **上限** が要 (#259 レビュー反映)
 * 下限しかないと、いま公開したばかりのイベントまで参加者0に数えてしまう。
 * イベント複製で定例シリーズを5件まとめて公開しただけで
 * event_burst と同時に発火する（最も普通の運用が誤検知される）。
 * 「公開して minAgeMs 経っても誰も来ていない」を見たいので、下限と上限の両方を置く。
 *
 * ■ 参加者の数え方 (#259 レビュー反映)
 * status='confirmed' だけを数えると、抽選枠(applied)・キャンセル待ち(waitlist)が
 * 全部0人扱いになる。**申込者20名×5イベントの抽選待ち**（ハッカソン運営という
 * 本サービスの中心ユースケース）が丸ごと誤検知されるので、status は見ずに
 * 「staff 以外のメンバー行が1件でもあるか」で判定する。
 * staff を除くのは、イベント作成時に作成者の staff 行が必ず作られるため
 * （除かないと常に1人になり、このルールが永久に発火しなくなる）。
 *
 * ■ 日程調整中は対象外 (#259 レビュー反映)
 * scheduling=1 は日程が決まる前の状態で、参加者がいないのが正常。 */
async function detectEmptyEventSpam(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { windowMs, minAgeMs, min } = T.emptyEventSpam;
  q.n += 1;
  const rows = await many<UserRuleRow & { empty: number; total: number }>(
    `SELECT e.created_by AS user_id, u.username AS handle,
            COALESCE(SUM(CASE WHEN NOT EXISTS (
              SELECT 1 FROM event_member m
               WHERE m.event_id = e.id AND m.role <> 'staff'
            ) THEN 1 ELSE 0 END), 0) AS empty,
            COUNT(1) AS total
       FROM event e JOIN user u ON u.id = e.created_by
      WHERE e.created_at >= ? AND e.created_at <= ?
        AND e.status = 'published' AND e.scheduling = 0
        AND u.deleted_at IS NULL
      GROUP BY e.created_by
     HAVING empty >= ?`,
    now - windowMs,
    now - minAgeMs,
    min,
  );
  return rows.map((r) => ({
    subjectUserId: r.user_id,
    subjectHandle: r.handle,
    detail: {
      emptyEvents: r.empty,
      createdEvents: r.total,
      // 実際に評価している幅（minAgeMs より新しいイベントは対象外）
      windowDays: Math.round((windowMs - minAgeMs) / DAY_MS),
      minAgeDays: Math.round(minAgeMs / DAY_MS),
    },
  }));
}

/** 大量キャンセル (#259 レビュー反映で判定式を変更)。
 *
 * ■ 判定式
 *   分子 canceled = 直近 windowMs(7日) に **キャンセルされた** 参加登録の件数
 *                   (status='canceled' AND canceled_at >= now - windowMs)
 *   分母 total    = 同一ユーザーの対象行の件数。対象行は
 *                   「直近 baselineWindowMs(30日) に **作成された** 登録」
 *                   **または**「直近 windowMs にキャンセルされた登録」
 *   検知条件      = canceled >= min かつ canceled / total >= minRate
 *
 * ■ なぜ分子を canceled_at にするか
 * 旧実装は母数も分子も「直近7日に **作成された** 登録」だったため、
 * 8日前に20件登録して今日10件キャンセルした常習者が検知0だった。
 *
 * ■ なぜ分母に30日の登録を混ぜるか
 * 分母を「7日以内にキャンセルされた行」だけにすると率が常に 1.0 になり、
 * minRate が判定として意味を持たなくなる。普段からよく参加している人ほど
 * 分母が大きくなり、率で弾ける。
 *
 * 主催・スタッフ行 (role='staff') と下書きイベントは除く。
 * 日程調整中の取消 (canceled_scheduling) は KPI と同様に数えない。 */
async function detectCancelBurst(
  now: number,
  q: QueryCount,
): Promise<Candidate[]> {
  const { windowMs, baselineWindowMs, min, minRate } = T.cancelBurst;
  const canceledSince = now - windowMs;
  q.n += 1;
  // 対象行の絞り込みを OR で書くと SQLite がどちらのインデックスも使えず
  // event_member を丸ごと SCAN する（実測 598ms / 33万行）。UNION に分けると
  // created_at と canceled_at のインデックスがそれぞれ効いて 21ms になる
  const rows = await many<UserRuleRow & { canceled: number; total: number }>(
    `WITH targets AS (
       SELECT id FROM event_member WHERE created_at >= ?
       UNION
       SELECT id FROM event_member WHERE canceled_at IS NOT NULL AND canceled_at >= ?
     )
     SELECT m.user_id AS user_id, u.username AS handle,
            COALESCE(SUM(CASE WHEN m.status = 'canceled'
                               AND m.canceled_scheduling = 0
                               AND m.canceled_at >= ?
                              THEN 1 ELSE 0 END), 0) AS canceled,
            COUNT(1) AS total
       FROM targets
       JOIN event_member m ON m.id = targets.id
       JOIN event e ON e.id = m.event_id
       JOIN user u ON u.id = m.user_id
      WHERE m.role <> 'staff'
        AND e.status = 'published' AND u.deleted_at IS NULL
      GROUP BY m.user_id
     HAVING canceled >= ? AND (canceled * 1.0 / total) >= ?`,
    now - baselineWindowMs,
    canceledSince,
    canceledSince,
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
      baselineDays: Math.round(baselineWindowMs / DAY_MS),
    },
  }));
}

/** 全体の登録急増: 直近の「完了した1日」(JST) の新規登録が、その前の
 * baselineDays 日の平均の ratio 倍以上 **かつ** min 件以上。
 * 特定ユーザーの話ではないので subject_user_id は NULL。
 *
 * ベースラインは **常に baselineDays(14) で割る**（実データのある日数では割らない）。
 * サービス開始直後のようにデータが14日ぶん無い時期は平均が小さく出るため、
 * min 件ちょうどでほぼ必ず発火する。初期は運営が目を通せばよいので意図した挙動。 */
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

/** 抑制リストの判定器。rule が NULL の行はその user の全ルールを抑制する */
function makeSuppressor(
  keys: Array<{ userId: string; rule: string | null }>,
): (rule: AbuseRule, subjectUserId: string | null) => boolean {
  const all = new Set<string>();
  const perRule = new Set<string>();
  for (const k of keys) {
    if (k.rule === null) all.add(k.userId);
    else perRule.add(abuseFlagKey(k.rule, k.userId));
  }
  return (rule, subjectUserId) => {
    // signup_spike のようなサービス全体の検知は抑制対象にしない
    if (subjectUserId === null) return false;
    return all.has(subjectUserId) || perRule.has(abuseFlagKey(rule, subjectUserId));
  };
}

/** 同じ事象で複数ルールが同時に鳴るのを抑える (#259 レビュー反映)。
 *
 * 新規主催者が登録直後にシリーズを5件立てると event_burst と
 * new_account_burst の両方に出る。運営が見るのは同じ人・同じ行動なので、
 * より情報量の多い event_burst に寄せて new_account_burst からは落とす。
 * （empty_event_spam の同時発火は、作成から48時間の下限を置いたことで解消済み） */
function dropOverlaps(
  byRule: Partial<Record<AbuseRule, Candidate[]>>,
): void {
  const eventBurstUsers = new Set(
    (byRule.event_burst ?? []).map((c) => c.subjectUserId),
  );
  if (eventBurstUsers.size === 0) return;
  byRule.new_account_burst = (byRule.new_account_burst ?? []).filter(
    (c) => !eventBurstUsers.has(c.subjectUserId),
  );
}

export async function detectAbuse(): Promise<DetectAbuseResult> {
  const now = Date.now();
  const q: QueryCount = { n: 0 };
  const failedRules: string[] = [];

  // 重複抑制と抑制リストの判定材料を先に1クエリずつまとめて取る。
  // ここは **意図的に try/catch していない**。判定材料が読めない状態で
  // 検知を続けると、抑制すべきものを全部記録して運営に通知してしまうため、
  // バッチごと失敗させて GHA のリトライに任せるほうが安全
  q.n += 2;
  const [recent, allowlistKeys] = await Promise.all([
    abuseFlagsRepo.recentKeys(now - ABUSE_FLAG_COOLDOWN_MS),
    abuseAllowlistRepo.listKeys(),
  ]);
  const isSuppressed = makeSuppressor(allowlistKeys);

  // まず全ルールを評価する（ルール間の重複判定に他ルールの結果が要るため）
  const candidatesByRule: Partial<Record<AbuseRule, Candidate[]>> = {};
  for (const rule of ABUSE_RULES) {
    try {
      candidatesByRule[rule] = await DETECTORS[rule](now, q);
    } catch (e) {
      // 1ルールの失敗で他のルールを止めない
      failedRules.push(rule);
      console.error(`[abuse] rule ${rule} failed`, e);
    }
  }
  dropOverlaps(candidatesByRule);

  const toRecord: AbuseFlagInput[] = [];
  const byRule: Record<string, number> = {};
  let skipped = 0;
  let suppressed = 0;

  for (const rule of ABUSE_RULES) {
    byRule[rule] = 0;
    for (const cand of candidatesByRule[rule] ?? []) {
      // 抑制リストに入っている正当なヘビーユーザーは記録も通知もしない
      if (isSuppressed(rule, cand.subjectUserId)) {
        suppressed += 1;
        continue;
      }
      const key = abuseFlagKey(rule, cand.subjectUserId);
      // クールダウン期間内に **未確認の** 記録があればスキップ。同じバッチ内の
      // 重複もここで潰れるよう、記録予定のキーも recent に足していく
      if (recent.has(key)) {
        skipped += 1;
        continue;
      }
      recent.add(key);
      toRecord.push({ rule, ...cand });
      byRule[rule] += 1;
    }
  }

  if (toRecord.length > 0) {
    q.n += Math.ceil(toRecord.length / 50);
    // ここも **意図的に try/catch していない**。記録できなければ検知は無かったのと
    // 同じで、握りつぶすと「成功したのに何も残っていない」状態になる。
    // 500 を返して GHA 側で失敗として見えるようにする
    // （ルール単位の隔離は「他のルールは活かす」ためのもので、目的が違う）
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
    suppressed,
    byRule,
    failedRules,
    notified,
    queries: q.n,
  };
}
