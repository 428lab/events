import { z } from "zod";
import { saveSurveyQuestionItem } from "./eventSurvey.js";
import type { SurveyQtype } from "./eventSurvey.js";

/**
 * 開催前アンケート (#444)。設計は docs/pre-event-survey.md。
 *
 * 下書きイベントの主催者が作り、**推測不能トークンのURL（/s/:token）を知っている
 * 人だけ**が回答する。回答者向けの応答に載るのは主催者がこのアンケートのために
 * 書いたものだけ（イベント本体の情報は一切返さない——サーバー側の責務）。
 *
 * 質問の形（qtype・選択肢・検証）は参加アンケート (#152 eventSurvey.ts) の
 * 部品を共用する。表とアクセスモデルは別物（あちらはログイン済み参加者・
 * 1人1回・上書き可、こちらはトークン・未ログイン可・送信1回きり）。
 */

/** 1アンケートの回答上限。溢れさせる荒らしの打ち止め（1文の条件付き挿入で守る） */
export const PRE_SURVEY_MAX_RESPONSES = 1000;

/** 自由記述の1回答の上限（#152 の500字より長め。開催前の要望を書き切れる長さ） */
export const PRE_SURVEY_TEXT_MAX = 2000;

export const PRE_SURVEY_STATUSES = ["open", "closed"] as const;
export type PreSurveyStatus = (typeof PRE_SURVEY_STATUSES)[number];

/** 回答者向けの質問（id と表示に要るものだけ。eventId は持たない） */
export interface PreSurveyQuestion {
  id: string;
  question: string;
  qtype: SurveyQtype;
  options: string[];
  required: boolean;
  sortOrder: number;
}

/** GET /api/public/pre-surveys/:token のレスポンス。
 * **イベント本体の情報（eventId・タイトル・日時・主催者名）は絶対に載せない**。
 * closed のときは質問すら返さない（タイトルと状態だけ） */
export type PublicPreSurvey =
  | { status: "open"; title: string; description: string; questions: PreSurveyQuestion[] }
  | { status: "closed"; title: string };

/** 主催者の管理画面用（staff のみ）。トークン・回答数込み */
export interface PreSurveyAdminView {
  id: string;
  title: string;
  description: string;
  status: PreSurveyStatus;
  token: string;
  responseCount: number;
  createdAt: number;
  questions: PreSurveyQuestion[];
}

/** PUT /api/events/:id/pre-survey の入力（作成/更新の一括保存。#152 の保存の型） */
export const savePreSurveyInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(2000).default(""),
    questions: z.array(saveSurveyQuestionItem).max(20),
  })
  .superRefine((v, ctx) => {
    v.questions.forEach((q, i) => {
      if (
        (q.qtype === "select" || q.qtype === "checkbox") &&
        q.options.length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "選択式の質問には選択肢を1つ以上設定してください",
          path: ["questions", i, "options"],
        });
      }
    });
  });
export type SavePreSurveyInput = z.infer<typeof savePreSurveyInput>;

/** 回答の送信入力（送信1回きり・編集なし）。
 * checkbox は string[]（サーバーで JSON 文字列に正規化して保存） */
export const submitPreSurveyInput = z.object({
  /** 記名で回答する（回答者の明示同意 #448）。**ログイン中かつこれが true の
   * ときだけ** user_id が保存される（アカウントの紐づけは回答者の選択だけで
   * 決まる。主催者側の設定は無い）。それ以外は保存しない＝持たない */
  named: z.boolean().default(false),
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        value: z.union([
          z.string().max(PRE_SURVEY_TEXT_MAX),
          z.array(z.string().max(200)).max(20),
        ]),
      }),
    )
    .max(20),
});
export type SubmitPreSurveyInput = z.infer<typeof submitPreSurveyInput>;

/** 集計: 選択式1問ぶん（選択肢ごとの件数。割合は表示側で出す） */
export interface PreSurveyChoiceResult {
  question: PreSurveyQuestion;
  /** options と同じ並びの件数 */
  counts: number[];
  /** この質問に答えた回答数（割合の分母） */
  answered: number;
}

/** 集計: 自由記述1問ぶん（新しい順の一覧） */
export interface PreSurveyTextResult {
  question: PreSurveyQuestion;
  answers: { value: string; createdAt: number }[];
}

/** GET /api/events/:id/pre-survey/results のレスポンス（staff のみ）。
 * 回答者の名前は出さない（匿名回答と扱いを揃える）。内訳は人数だけ */
export interface PreSurveyResults {
  total: number;
  /** 記名回答の件数（同意して user_id が保存された送信 #448） */
  named: number;
  choices: PreSurveyChoiceResult[];
  texts: PreSurveyTextResult[];
}

/** 回答一覧の1行 (#447)。行=1送信。値は保存形のまま（checkbox は JSON array 文字列。
 * 表示は surveyValueLabel の1か所で「、」連結する——写しを作らない） */
export interface PreSurveyResponseRowView {
  /** 送信日時 */
  createdAt: number;
  /** 記名回答者の表示名 (#448)。匿名（未同意・未ログイン）・退会は null */
  respondent: string | null;
  /** questionId → 保存値（未回答の質問はキーなし） */
  answers: Record<string, string>;
}

/** 送信値の型が qtype に合っているか（text/select は文字列、checkbox は配列） */
export function preSurveyValueMatches(
  qtype: SurveyQtype,
  value: string | string[],
): boolean {
  return qtype === "checkbox" ? Array.isArray(value) : typeof value === "string";
}

