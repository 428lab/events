import { z } from "zod";

/**
 * 出会いの景品引き換え (#431)。
 *
 * 出会いの記録（QRの読み合い）に達成条件を付け、達成した参加者が窓口で
 * 景品と引き換えられるモード。設計は docs/meet-prizes.md。
 *
 * - 達成は保存せず、件数（#418 と同じ集計）から読むたびに導出する
 * - 在庫は「引き換えた順」の早い者勝ち（達成順の予約はしない）
 * - ランキング1位は主催者が「締める」操作で確定する（同率は全員）
 */

/** 達成条件の種類。
 * - meet_count: N人と出会う（N は自由入力。5/10/20 は編集UIの既定候補）
 * - top_rank: 出会った人数ランキング1位（主催者が締めて確定した人）
 * - bingo: ビンゴ達成 (#436)。この種別の景品は「ビンゴ景品プール」で、
 *   達成者はプールから好きな1つを選ぶ（プール全体で1人1回） */
export const MEET_PRIZE_CONDITIONS = ["meet_count", "top_rank", "bingo"] as const;
export type MeetPrizeCondition = (typeof MEET_PRIZE_CONDITIONS)[number];

/** 編集UIに出す「N人到達」の既定候補（issue の 5/10/20） */
export const MEET_PRIZE_THRESHOLD_PRESETS = [5, 10, 20] as const;

/** 1イベントに作れる景品の上限。公開ページに並ぶので無制限にしない */
export const MEET_PRIZE_MAX = 20;

/** 景品画像 (#434)。カードの正方形サムネイル用のクロップ先サイズと最大バイト数
 * （イベント画像 EVENT_IMAGE と同じ形の契約。値の流用はしない——役割が別） */
export const MEET_PRIZE_IMAGE = {
  width: 512,
  height: 512,
  maxBytes: 1024 * 1024, // 1MB
} as const;

/** 景品の定義（staff の編集画面・デスク画面が使う内部形） */
export interface MeetPrize {
  id: string;
  eventId: string;
  name: string;
  description: string;
  conditionType: MeetPrizeCondition;
  /** meet_count のときの必要人数。top_rank は null */
  threshold: number | null;
  /** 在庫総数（残数は引き換え記録から導出） */
  stock: number;
  /** 景品画像の R2 キー（任意 #434）。バケットは公開しない前提（配信は必ず
   * API 経由の門を通す）。公開応答に載るのは配信 URL だけ */
  imageKey: string | null;
  createdAt: number;
}

const prizeFields = {
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  conditionType: z.enum(MEET_PRIZE_CONDITIONS),
  threshold: z.number().int().min(1).max(1000).nullable().optional(),
  stock: z.number().int().min(0).max(1000),
};

/** meet_count なのに人数が無い／top_rank・bingo なのに人数がある、を作らせない。
 * bingo の NULL 強制は DB の CHECK では縛れない（変更は再構築になる）ので、
 * この zod が正の門（docs/bingo.md §3.7） */
function thresholdMatchesCondition(v: {
  conditionType: MeetPrizeCondition;
  threshold?: number | null;
}): boolean {
  return v.conditionType === "meet_count"
    ? typeof v.threshold === "number"
    : v.threshold == null;
}

export const createMeetPrizeInput = z
  .object(prizeFields)
  .refine(thresholdMatchesCondition, {
    message: "threshold must match conditionType",
    path: ["threshold"],
  });
export type CreateMeetPrizeInput = z.infer<typeof createMeetPrizeInput>;

/** 更新は全項目を送る（部分更新にしない。編集フォームが常に全体を持つため） */
export const updateMeetPrizeInput = createMeetPrizeInput;
export type UpdateMeetPrizeInput = z.infer<typeof updateMeetPrizeInput>;

/** POST …/meet-prizes/:prizeId/redeem の入力（staff が付ける相手） */
export const redeemMeetPrizeInput = z.object({
  userId: z.string().min(1).max(64),
});
export type RedeemMeetPrizeInput = z.infer<typeof redeemMeetPrizeInput>;

/** 引き換えが断られた理由。窓口で参加者に案内する文言が変わるため区別する。
 * - already_redeemed: この景品は交換済み
 * - out_of_stock: 在庫切れ（早い者勝ちに間に合わなかった）
 * - not_achieved: 条件を満たしていない（取り消しで人数が減った・1位未確定を含む）
 * - not_confirmed: 参加が確定していない */
export type MeetPrizeRedeemFailure =
  | "already_redeemed"
  | "out_of_stock"
  | "not_achieved"
  | "not_confirmed";

/** 公開一覧の1件。個人を指す値は載せない（設計 §3.9） */
export interface MeetPrizeView {
  id: string;
  name: string;
  description: string;
  conditionType: MeetPrizeCondition;
  threshold: number | null;
  stock: number;
  /** 残数（0未満にはならない。在庫を後から減らした場合は 0 に丸める） */
  stockLeft: number;
  /** 景品画像の URL（無ければ null #434） */
  imageUrl: string | null;
}

/** 景品画像の URL (#434)。サーバーの公開応答（imageUrl）と、staff 画面が
 * MeetPrize.imageKey から組む URL の**唯一の**組み立て場所。
 * `v=` はキー末尾（アップロードごとに変わる乱数）で、差し替え後に古い
 * キャッシュを見続けないためのもの */
export function meetPrizeImageUrl(
  eventId: string,
  prizeId: string,
  imageKey: string | null,
): string | null {
  if (!imageKey) return null;
  const tail = imageKey.split("/").pop()!;
  return `/api/events/${eventId}/meet-prizes/${prizeId}/image?v=${tail}`;
}

/** 公開一覧に添える本人の状態（確定メンバーだけ。他人の分は返さない）。
 * 達成の表示は count / won から導出できる（meet_count は count >= threshold、
 * top_rank は won）。判定の正は引き換え時のサーバー再検証 */
export interface MeetPrizeMe {
  /** 自分の出会い人数 */
  count: number;
  /** 確定済みの1位に自分が入っているか（未確定なら false） */
  won: boolean;
  /** ビンゴを達成しているか (#436)。ゲームが無ければ false */
  bingo: boolean;
  /** 交換済みの景品 id */
  redeemedPrizeIds: string[];
}

/** GET /api/events/:id/meet-prizes のレスポンス。
 * 公開部分に個人を指す値を載せないのはサーバー側の責務（勝者名は bool のみ） */
export interface MeetPrizeList {
  prizes: MeetPrizeView[];
  /** 1位が確定済みか（勝者が誰かは載せない） */
  winnersDecided: boolean;
  me: MeetPrizeMe | null;
}

/** デスク画面の達成者1行（staff のみ） */
export interface MeetPrizeAchiever {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  count: number;
  redeemed: boolean;
  redeemedAt: number | null;
}

/** デスク画面の景品1件（staff のみ） */
export interface MeetPrizeStatusRow {
  prize: MeetPrize;
  stockLeft: number;
  redeemedCount: number;
  achievers: MeetPrizeAchiever[];
}

/** 確定済みの1位（staff のみ。締めた時点のスナップショット） */
export interface MeetWinner {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  count: number;
  decidedAt: number;
}

/** デスクのビンゴ景品プールの達成者1行 (#436)。達成順（同着は同順位）で並べる。
 * 選び取りの順序はシステムで裁かず、staff が引き換えを付けた順が記録に残る */
export interface MeetPrizeBingoAchiever {
  userId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  rank: number;
  completedAtSeq: number;
  /** プールから選んで交換済みの景品 id（未交換は null） */
  redeemedPrizeId: string | null;
  redeemedAt: number | null;
}

/** GET /api/events/:id/meet-prizes/status のレスポンス（staff のみ） */
export interface MeetPrizeStatus {
  prizes: MeetPrizeStatusRow[];
  winners: MeetWinner[];
  /** ビンゴ景品プールの達成者（達成順）。ゲームやプール景品が無ければ空 (#436) */
  bingoAchievers: MeetPrizeBingoAchiever[];
}
