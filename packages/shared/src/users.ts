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
  /** events のうち、タイムテーブルで登壇者として紐づいているイベントの id (#308)。
   * 参加履歴の年表で「登壇」を添えるために使う */
  speakerEventIds: z.array(z.string()),
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

/** ハンドルの許可パターン (#236)。半角英数字と _ . - に加え内部スペースを許容。
 * 先頭・末尾・連続スペースは「見えない差分で別ハンドル」ができるため不可。2〜32文字 */
export const USERNAME_PATTERN =
  /^(?=.{2,32}$)[A-Za-z0-9_.-]+( [A-Za-z0-9_.-]+)*$/;

/** ユーザー名（プロフィールURLのハンドル）の変更入力。URL安全な文字のみ・2〜32文字 */
export const updateUsernameInput = z.object({
  username: z
    .string()
    .trim()
    .regex(
      USERNAME_PATTERN,
      "半角英数字と _ . - スペースのみ（前後スペース不可）、2〜32文字で入力してください",
    ),
});
export type UpdateUsernameInput = z.infer<typeof updateUsernameInput>;

/** 表示名に許可しない不可視・制御文字 (#232)。
 * 制御文字(C0/DEL)・bidi制御（表示順を乱す）・ゼロ幅スペース（見た目が空の名前）。
 * U+200D(ZWJ)と異体字セレクタは絵文字の合成に必要なので許可する */
const DISPLAY_NAME_FORBIDDEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** アカウント統合の実行入力 (#240)。
 * code: もう一方のアカウントで発行した統合コード。
 * keep: どちらのアカウントを残すか（me=いまログイン中 / other=コードを発行した側） */
export const mergeAccountInput = z.object({
  code: z.string().trim().min(1).max(300),
  keep: z.enum(["me", "other"]),
});
export type MergeAccountInput = z.infer<typeof mergeAccountInput>;

/** 退会（アカウント削除）の実行入力 (#244)。
 * 猶予期間 (#250) を挟むが、誤操作防止のため confirm: true は引き続き必須 */
export const deleteAccountInput = z.object({
  confirm: z.literal(true),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountInput>;

/** 退会の猶予期間 (#250)。この期間内に同じログイン方法でログインすれば復帰でき、
 * 経過後は日次バッチが完全削除する。UI 文言もこの日数を参照する */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
export const ACCOUNT_DELETION_GRACE_MS =
  ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** 猶予期間中のアカウントでログインしたときに /api/auth/me が返す情報 (#250)。
 * SPA はこれを見て復帰画面へ誘導する */
export const pendingDeletionSchema = z.object({
  /** 退会を申請した時刻 */
  deletedAt: z.number(),
  /** 完全削除が実行される時刻（deletedAt + 猶予期間） */
  purgeAt: z.number(),
  /** 復帰画面で「どのアカウントか」を示すためのハンドル */
  username: z.string(),
});
export type PendingDeletion = z.infer<typeof pendingDeletionSchema>;

/** 退会したユーザーの表示名 (#244, #250)。
 * 完全削除後の「退会済みユーザー」(ghost) の表示名であり、猶予期間中に
 * 表示名のコピー（個人エントリーの entry.name 等）を伏せるときの置換先でもある。
 * 猶予期間中は元の name をそのまま残し、表示のときだけこの値に差し替える
 * ので、復帰すれば元の表示名に戻る */
export const DELETED_USER_DISPLAY_NAME = "退会済みユーザー";

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
