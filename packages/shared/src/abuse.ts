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
  empty_event_spam: "公開したのに参加者が0のままのイベントが続いている",
  cancel_burst: "参加登録に対するキャンセルの件数・割合が高い",
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
  /** コメント・いいねの連投: 1時間で30件以上。
   * 日次バッチなので「直近1時間」だけを見ると取りこぼす。lookbackMs の範囲を
   * windowMs 幅のバケットに割り、**最大のバケット**がしきい値以上なら検知する
   * （バケットはエポック基準の固定境界なので、境界をまたぐ連投は分割されうる。
   *   取りこぼす方向の誤差なので過検知にはならない）。 */
  commentBurst: { windowMs: HOUR, lookbackMs: DAY, min: 30 },
  /** 新規アカウントの即時大量行動: 登録から24時間以内にイベント作成3件以上。
   * lookbackMs は「いつ登録した人まで見るか」（古い新規は毎日は見直さない） */
  newAccountBurst: { withinMs: DAY, min: 3, lookbackMs: 7 * DAY },
  /** 参加者0のイベント量産: 直近7日に作成した公開イベントのうち参加者0が5件以上 */
  emptyEventSpam: { windowMs: 7 * DAY, min: 5 },
  /** 大量キャンセル: 期間内のキャンセルが10件以上 **かつ** キャンセル率が高い。
   * 母数は同じ期間に作成された参加登録（主催・スタッフ行と下書きイベントは除く） */
  cancelBurst: { windowMs: 7 * DAY, min: 10, minRate: 0.5 },
  /** 全体の登録急増: 対象日の新規登録が直近 baselineDays 日平均の ratio 倍以上。
   * 平均が小さいと簡単に倍率を超えるので min 件数も必須にしている */
  signupSpike: { baselineDays: 14, ratio: 3, min: 10 },
} as const;

/** 同じ subject × 同じ rule はこの期間内に既に記録があればスキップする。
 * 運営への通知が毎日同じ内容で飛ぶのを防ぐため (#259) */
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
  canceled: "キャンセル",
  registrations: "参加登録",
  cancelRate: "キャンセル率",
  perHour: "1時間あたり最大",
  day: "対象日",
  signups: "新規登録",
  baselineAvg: "直近平均",
  ratio: "倍率",
};
