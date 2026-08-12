import { z } from "zod";

/** イベントQ&A (#216)。参加確定メンバーが質問を投稿し、投票の多い順に並ぶ。
 * 票の集計・重複投票の防止・モデレーションが要るのでサーバー（D1）で持つ
 * （チャット #199 のようなリレー直結にはしない）。 */

/** 匿名の扱い。運営が範囲を決め、その中で参加者が選ぶ:
 * - real: 実名のみ（投稿者を必ず表示）
 * - anon: 匿名のみ（一般参加者には投稿者を表示しない）
 * - choice: 投稿ごとに投稿者が実名/匿名を選べる（既定） */
export const QA_ANONYMITY_MODES = ["real", "anon", "choice"] as const;
export type QaAnonymity = (typeof QA_ANONYMITY_MODES)[number];

/** 質問1件の最大文字数。チャット (500) より短くしているのは、
 * Q&A は「投影画面に大きく出す」用途があり、長文だと読めなくなるため */
export const QA_QUESTION_MAX = 300;

/** 1イベントに投稿できる質問の総数。いたずら対策で EVENT_COMMENT_LIMIT と同じ考え方。
 * 一覧はページングなしで全件返し、参加者全員がポーリングで取りに来るので、
 * 上限がないと荒らし1人で全員のレスポンスが膨らむ */
export const EVENT_QUESTION_LIMIT = 200;

/** 1人が同じイベントに投稿できる質問の数。総数の上限を1人で使い切れないようにする */
export const EVENT_QUESTION_USER_LIMIT = 20;

/** 質問の投稿者。匿名投稿では一般参加者に対して null になる
 * （イベントのスタッフには荒らし対応のため常に入る） */
export const qaAuthorSchema = z.object({
  id: z.string(),
  username: z.string(),
  /** 表示名（globalName ?? username） */
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type QaAuthor = z.infer<typeof qaAuthorSchema>;

/** 質問1件（サーバーが返す形） */
export const eventQuestionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  body: z.string(),
  createdAt: z.number(),
  /** 匿名投稿として扱うか（表示上のフラグ。投稿者IDは常に記録されている） */
  anonymous: z.boolean(),
  /** スタッフが「回答済み」にした */
  answered: z.boolean(),
  /** スタッフが非表示にした（この質問はモデレーションできる人にしか返さない） */
  hidden: z.boolean(),
  votes: z.number(),
  /** 自分が投票済みか */
  votedByMe: z.boolean(),
  /** 自分の投稿か（匿名でも本人には分かるようにする） */
  mine: z.boolean(),
  /** 投稿者。匿名投稿は一般参加者には null、イベントのスタッフには入る */
  author: qaAuthorSchema.nullable(),
});
export type EventQuestion = z.infer<typeof eventQuestionSchema>;

/** GET /events/:id/questions のレスポンス */
export interface EventQaPayload {
  qaEnabled: boolean;
  anonymity: QaAnonymity;
  /** 「いまこの質問」（#215 の投影画面で大きく出す1件）。未設定は null */
  pickedQuestionId: string | null;
  /** 投稿・投票ができるか（Q&Aが有効で、自分が参加確定メンバー） */
  canPost: boolean;
  /** モデレーション操作（回答済み・非表示・ピックアップ）ができるか。
   * 非表示の質問も questions に含まれている。
   * **そのイベントの参加確定 staff メンバーだけ** true。アプリ運営管理者や
   * コミュニティ管理者でも、そのイベントの staff でなければ false
   * （イベント配下の表示・操作はイベント内の役割だけで判定する方針）。
   * web の操作UIはこの値で出す */
  canModerate: boolean;
  /** 匿名投稿の author が入っているか。
   * 条件はいま canModerate と同じ（そのイベントの staff）だが、
   * 「操作できるか」と「実名が見えるか」は別の話なので項目は分けてある。
   * web はこの値をそのまま QaQuestionList の revealAuthor に渡す */
  revealsAuthor: boolean;
  questions: EventQuestion[];
}

/** 質問の投稿。anonymity='choice' のときだけ anonymous を尊重する
 * （'real' は常に実名、'anon' は常に匿名にサーバー側で寄せる） */
export const createQuestionInput = z.object({
  body: z.string().trim().min(1).max(QA_QUESTION_MAX),
  anonymous: z.boolean().default(false),
});
export type CreateQuestionInput = z.infer<typeof createQuestionInput>;

/** 質問の状態更新（staff のみ）。省略した項目は変更しない */
export const updateQuestionInput = z
  .object({
    answered: z.boolean().optional(),
    hidden: z.boolean().optional(),
  })
  .refine((v) => v.answered !== undefined || v.hidden !== undefined, {
    message: "answered か hidden のどちらかは必要です",
  });
export type UpdateQuestionInput = z.infer<typeof updateQuestionInput>;

/** 「いまこの質問」の設定（staff のみ）。questionId=null で解除 */
export const pickQuestionInput = z.object({
  questionId: z.string().nullable(),
});
export type PickQuestionInput = z.infer<typeof pickQuestionInput>;

// 匿名設定のラベルは辞書 (`eventForm.qaAnonymity*`) が持つ (#363)。
// ここに日本語の表を戻すと、同じ文言が2か所に増える。
