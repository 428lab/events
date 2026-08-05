import { z } from "zod";

/** 異常行動の検知 (#259 PR2)。
 *
 * ここに出るのは「違反」ではなく **要確認**。毎週イベントを開く主催者のような
 * 正当なヘビーユーザーも普通に引っかかる。自動制限は一切せず、運営が目視して
 * 「確認済み」にする運用を前提にしている。
 *
 * しきい値はサービス規模で変わるため、**このファイル1箇所**にまとめてある。
 * 調整するときはここだけ触ればよい（サーバー・画面はここを参照する）。 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 検知ルールの識別子（abuse_flag.rule に入る値） */
export const ABUSE_RULES = [
  /** イベントの大量作成 */
  "event_burst",
  /** たまご（イベントリクエスト）の大量投稿 */
  "egg_burst",
  /** コメント・いいねの連投 */
  "comment_burst",
  /** 新規アカウントの即時大量行動 */
  "new_account_burst",
  /** 参加者0のイベント量産 */
  "empty_event_spam",
  /** 大量キャンセル */
  "cancel_burst",
  /** サービス全体の新規登録の急増（特定ユーザーではない） */
  "signup_spike",
] as const;
export type AbuseRule = (typeof ABUSE_RULES)[number];

/** 画面表示用の日本語ラベル。未知の値はそのまま表示する */
export const ABUSE_RULE_LABELS: Record<AbuseRule, string> = {
  event_burst: "イベントの大量作成",
  egg_burst: "たまごの大量投稿",
  comment_burst: "コメント・いいねの連投",
  new_account_burst: "新規アカウントの即時大量行動",
  empty_event_spam: "参加者0のイベントが続いている",
  cancel_burst: "キャンセルが多い",
  signup_spike: "新規登録の急増（サービス全体）",
};

/** 「何を見て引っかかったのか」の1行説明（画面の補助テキスト） */
export const ABUSE_RULE_DESCRIPTIONS: Record<AbuseRule, string> = {
  event_burst: "短期間に作成されたイベントの件数が多い",
  egg_burst: "短期間に投稿されたたまごの件数が多い",
  comment_burst: "1時間あたりのコメント・いいねの件数が多い",
  new_account_burst: "登録直後にイベントをまとめて作成している",
  empty_event_spam:
    "公開から2日以上たっても申込・抽選待ちが0のままのイベントが続いている",
  cancel_burst: "直近7日にキャンセルした件数と、参加登録に対する割合が高い",
  signup_spike: "1日の新規登録数が直近の平均を大きく上回っている",
};

/** 検知のしきい値。**調整するのはここだけ**。
 * 初期値は #259 の表に合わせてある（サービス規模が変わったら見直す）。 */
export const ABUSE_THRESHOLDS = {
  /** イベントの大量作成: 24時間で5件以上 **または** 7日で15件以上 */
  eventBurst: {
    shortWindowMs: DAY,
    shortMin: 5,
    longWindowMs: 7 * DAY,
    longMin: 15,
  },
  /** たまごの大量投稿: 24時間で5件以上 */
  eggBurst: { windowMs: DAY, min: 5 },
  /** コメント・いいねの連投: 1時間で30件以上（いいねは kind='event' のみ数える。
   * 1イベントへのいいねは event/host/staff(人数分)/community で複数行になるため、
   * 全部数えると熱心な参加者が誤検知される）。
   *
   * 日次バッチなので「直近1時間」だけを見ると取りこぼす。lookbackMs の範囲を
   * windowMs 幅のバケットに割り、**最大のバケット**がしきい値以上なら検知する。
   * バケットの境界がエポック固定だと 58件/分のような連投が 29/29 に割れて
   * **恒久的に**不発になるので、windowMs/2 ずらした2系統のバケットを作り、
   * 両系統を通した最大値で判定する（最悪でもしきい値の 2/3 までしか割れない）。 */
  commentBurst: { windowMs: HOUR, lookbackMs: DAY, min: 30 },
  /** 新規アカウントの即時大量行動: 登録から24時間以内にイベント作成5件以上。
   * 3件だと「初めての主催者がその日にシリーズを3件立てる」という普通の導線で
   * 発火してしまうため、event_burst の短期しきい値と同じ5件に揃えてある。
   * さらに同じユーザーが event_burst にも出た場合はそちらに寄せる
   * （detectAbuse 側で落とす。同じ事象で2件記録しても運営の手間が増えるだけ）。
   * lookbackMs は「いつ登録した人まで見るか」（古い新規は毎日は見直さない） */
  newAccountBurst: { withinMs: DAY, min: 5, lookbackMs: 7 * DAY },
  /** 参加者0のイベント量産: 参加者0の公開イベントが5件以上。
   *
   * 対象は「作成から minAgeMs 以上経った」イベントだけ。**上限がないと
   * いま公開したばかりのイベントまで参加者0に数えてしまい**、イベント複製で
   * 定例シリーズを5件まとめて公開しただけで発火する（最も普通の運用）。
   * windowMs は minAgeMs も含んだ長さなので、実際に評価する幅は
   * windowMs - minAgeMs = 7日 になる。 */
  emptyEventSpam: { windowMs: 9 * DAY, minAgeMs: 2 * DAY, min: 5 },
  /** 大量キャンセル: 直近7日に **キャンセルされた** 件数が10件以上
   * **かつ** キャンセル率が minRate 以上。
   *
   * 分子を「7日以内に作成された登録のうちキャンセル済み」にすると、
   * 8日前に20件登録して今日10件キャンセルした常習者が丸ごと漏れる。
   * 分母は率が常に 1.0 にならないよう baselineWindowMs(30日) の登録も含める
   * （詳しい判定式は detectAbuse.ts の detectCancelBurst のコメント参照）。 */
  cancelBurst: {
    windowMs: 7 * DAY,
    baselineWindowMs: 30 * DAY,
    min: 10,
    minRate: 0.5,
  },
  /** 全体の登録急増: 対象日の新規登録が直近 baselineDays 日平均の ratio 倍以上。
   * 平均が小さいと簡単に倍率を超えるので min 件数も必須にしている。
   *
   * ベースラインは**常に baselineDays で割る**（実データのある日数では割らない）。
   * そのためサービス開始直後のようにデータが baselineDays 日ぶん無い時期は
   * 平均が小さく出て、min 件ちょうどでほぼ必ず発火する。これは意図した挙動で、
   * 「初期は登録が少しでも増えたら運営が目を通す」ことになる。 */
  signupSpike: { baselineDays: 14, ratio: 3, min: 10 },
} as const;

/** 同じ subject × 同じ rule はこの期間内に **未確認の** 記録があればスキップする。
 * 運営への通知が毎日同じ内容で飛ぶのを防ぐため (#259)。
 *
 * 確認済みにした記録はクールダウンの対象にしない。確認済みまで抑制すると
 * 「見た」瞬間に7日間その人が見えなくなり、継続中の荒らしを追えなくなるため。
 * 逆に、正当なヘビーユーザーが7日ごとに永久に再掲されるのを止めたい場合は、
 * 抑制リスト (abuse_allowlist) に入れて恒久的に除外する。 */
export const ABUSE_FLAG_COOLDOWN_MS = 7 * DAY;

/** 記録の保存期間（1年）。subject_handle は個人データにあたるため無期限に持たない
 * （監査ログ #248 と同じ方針）。検知バッチのたびに古い行を掃除する */
export const ABUSE_FLAG_RETENTION_MS = 365 * DAY;

/** 要確認リストの1ページあたり件数 */
export const ABUSE_FLAG_PAGE_SIZE = 50;

/** 要確認リストの1件。ユーザー行が消えても辿れるよう、検知時点のハンドルを持つ */
export const abuseFlagSchema = z.object({
  id: z.string(),
  /** AbuseRule のいずれか。将来追加された値も表示できるよう string で受ける */
  rule: z.string(),
  /** サービス全体の異常（signup_spike）は null */
  subjectUserId: z.string().nullable(),
  subjectHandle: z.string(),
  /** JSON文字列。件数やIDなどの最小限のみで、個人情報（メール・本文）は含めない */
  detail: z.string(),
  detectedAt: z.number(),
  reviewedAt: z.number().nullable(),
  reviewedBy: z.string().nullable(),
});
export type AbuseFlag = z.infer<typeof abuseFlagSchema>;

/** GET /api/admin/abuse-flags のレスポンス */
export const abuseFlagsPayloadSchema = z.object({
  flags: z.array(abuseFlagSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  /** 絞り込みによらない未確認の総数（運用メニューのバッジと同じ数） */
  unreviewed: z.number(),
});
export type AbuseFlagsPayload = z.infer<typeof abuseFlagsPayloadSchema>;

/** 抑制リストの1件 (#259 レビュー反映)。ここに入れた user × rule は
 * 検知の段階で落とすので、記録も通知も一切行われない */
export const abuseAllowlistEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** null なら全ルールを抑制 */
  rule: z.string().nullable(),
  /** 検知時点で分かるハンドル（user 行が残っていれば）。表示用 */
  handle: z.string(),
  /** 運営の自由記述。個人情報は書かない運用 */
  note: z.string(),
  createdAt: z.number(),
  createdBy: z.string(),
});
export type AbuseAllowlistEntry = z.infer<typeof abuseAllowlistEntrySchema>;

/** GET /api/admin/abuse-flags/allowlist のレスポンス */
export const abuseAllowlistPayloadSchema = z.object({
  entries: z.array(abuseAllowlistEntrySchema),
});
export type AbuseAllowlistPayload = z.infer<typeof abuseAllowlistPayloadSchema>;

/** POST /api/admin/abuse-flags/allowlist のリクエスト */
export const abuseAllowlistInputSchema = z.object({
  userId: z.string().min(1),
  /** 省略/null なら全ルールを抑制 */
  rule: z.string().min(1).nullable().optional(),
  note: z.string().max(200).optional(),
});
export type AbuseAllowlistInput = z.infer<typeof abuseAllowlistInputSchema>;

/** POST /api/cron/detect-abuse / POST /api/admin/run-detect-abuse のレスポンス */
export interface DetectAbuseResult {
  /** 新規に記録したフラグの件数 */
  recorded: number;
  /** クールダウン期間内の重複としてスキップした件数 */
  skipped: number;
  /** ルール別の新規記録件数（0件のルールも含む） */
  byRule: Record<string, number>;
  /** 実行に失敗したルール（他のルールは止めない）。空なら全ルール成功 */
  failedRules: string[];
  /** 抑制リスト (abuse_allowlist) で落とした件数 */
  suppressed: number;
  /** 通知した運営管理者の人数（0なら通知なし） */
  notified: number;
  /** 消費した D1 クエリ本数。Workers のサブリクエスト上限(50)の監視用 */
  queries: number;
}

/** detail(JSON文字列) を画面表示用の「ラベル: 値」の並びにする。
 * 未知のキーもそのまま出す（ルール追加時に画面を直さなくてよいように） */
export const ABUSE_DETAIL_LABELS: Record<string, string> = {
  count: "件数",
  dayCount: "24時間",
  weekCount: "7日間",
  windowHours: "対象時間",
  windowDays: "対象日数",
  emptyEvents: "参加者0のイベント",
  createdEvents: "作成イベント",
  minAgeDays: "作成からの経過日数",
  canceled: "キャンセル",
  registrations: "参加登録",
  cancelRate: "キャンセル率",
  baselineDays: "母数の対象日数",
  perHour: "1時間あたり最大",
  day: "対象日",
  signups: "新規登録",
  baselineAvg: "直近平均",
  ratio: "倍率",
};
