import { z } from "zod";
import { myEventSummary } from "./schema.js";
import { communitySummarySchema } from "./communities.js";
import { gamificationSchema } from "./gamification.js";

/** 受賞歴の1件（公開プロフィール用。終了済み公開イベントのみ） */
export const userAwardSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string(),
  /** イベント終了日時（表示・並び順用） */
  endsAt: z.number(),
  /** 賞の名前（例: 最優秀賞、オーディエンス賞） */
  awardName: z.string(),
  /** 受賞した Entry 名（チーム名 or 本人名） */
  entryName: z.string(),
  /** ランキング賞なら順位（1が最上位）。特別枠は null */
  rankOrder: z.number().nullable(),
});
export type UserAward = z.infer<typeof userAwardSchema>;

/** 参加実績の集計（公開プロフィール用）。
 * 出席チェックを行わないイベントは登録=出席として数える。
 * キャンセルは開催日確定後の取消のみ対象（日程調整中の取消はノーカウント）。 */
export const participationStatsSchema = z.object({
  /** 出席した過去イベント数（未チェック運用のイベントは登録=出席扱い） */
  attended: z.number(),
  /** 無断欠席数（出席チェックONのイベントで登録したまま出席記録なし） */
  noShow: z.number(),
  /** 事前キャンセル数（開始24時間より前の取消） */
  cancelEarly: z.number(),
  /** 直前キャンセル数（開始24時間以内の取消） */
  cancelLate: z.number(),
  /** 主催した終了済みイベント数（イベントオーナー） */
  hosted: z.number(),
  /** スタッフとして参加した終了済みイベント数（オーナー分は含まない） */
  staffed: z.number(),
  /** 登壇した終了済みイベント数（タイムテーブルの担当にリンクされたイベント） */
  spoken: z.number(),
  /** 主催・スタッフとしてもらったいいねの合計（公開イベントのみ） (#155) */
  likesReceived: z.number(),
});
export type ParticipationStats = z.infer<typeof participationStatsSchema>;

/** 公開ユーザープロフィール（誰でも閲覧可） */
export const userProfileSchema = z.object({
  id: z.string(),
  handle: z.string().optional(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.number(),
  events: z.array(myEventSummary),
  communities: z.array(communitySummarySchema),
  awards: z.array(userAwardSchema),
  /** 参加実績（出席・無断欠席・キャンセル内訳） */
  participation: participationStatsSchema,
  /** XP・レベル・バッジ（有効イベントのみから導出） (#14) */
  gamification: gamificationSchema,
  /** フォロワー数（公開） */
  followerCount: z.number(),
  /** フォロー数（公開） */
  followingCount: z.number(),
  /** 閲覧者がこのユーザーをフォロー中か（未ログインは false） */
  isFollowing: z.boolean(),
  /** 本人のプロフィールか */
  isMe: z.boolean(),
  /** プロフィールカードPNG（OG画像）の更新時刻。未生成は null (#193) */
  cardImageUpdatedAt: z.number().nullable(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/** ユーザー名（プロフィールURLのハンドル）の変更入力。URL安全な文字のみ・2〜32文字 */
export const updateUsernameInput = z.object({
  username: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9_.-]{2,32}$/,
      "半角英数字と _ . - のみ、2〜32文字で入力してください",
    ),
});
export type UpdateUsernameInput = z.infer<typeof updateUsernameInput>;

/** 表示名に許可しない不可視・制御文字 (#232)。
 * 制御文字(C0/DEL)・bidi制御（表示順を乱す）・ゼロ幅スペース（見た目が空の名前）。
 * U+200D(ZWJ)と異体字セレクタは絵文字の合成に必要なので許可する */
const DISPLAY_NAME_FORBIDDEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** 表示名の変更入力 (#232)。イベント・チャット等の表示に使われる */
export const updateDisplayNameInput = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .refine((v) => !DISPLAY_NAME_FORBIDDEN.test(v), {
      message: "使用できない文字（制御文字等）が含まれています",
    }),
});
export type UpdateDisplayNameInput = z.infer<typeof updateDisplayNameInput>;
