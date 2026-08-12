import { z } from "zod";

/** 参加アンケート (#152) のフェーズ。'pre'=参加登録時、'post'=事後アンケート (#153 予約) */
export const SURVEY_PHASES = ["pre", "post"] as const;
export type SurveyPhase = (typeof SURVEY_PHASES)[number];

/** 質問の回答形式 */
export const SURVEY_QTYPES = ["text", "select", "checkbox"] as const;
export type SurveyQtype = (typeof SURVEY_QTYPES)[number];

/** アンケートの質問（サーバーが返す形） */
export const surveyQuestionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  phase: z.enum(SURVEY_PHASES),
  question: z.string(),
  qtype: z.enum(SURVEY_QTYPES),
  /** select/checkbox の選択肢。text では空配列 */
  options: z.array(z.string()),
  required: z.boolean(),
  sortOrder: z.number(),
});
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

/** 質問の保存入力（1問）。id 付きは既存質問の更新（回答を保持）、無しは新規 */
export const saveSurveyQuestionItem = z.object({
  id: z.string().optional(),
  question: z.string().trim().min(1).max(200),
  qtype: z.enum(SURVEY_QTYPES).default("text"),
  options: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  required: z.boolean().default(false),
});
export type SaveSurveyQuestionItem = z.infer<typeof saveSurveyQuestionItem>;

/** 質問の一括保存入力（並び順は配列順）。select/checkbox は選択肢必須 */
export const saveSurveyQuestionsInput = z
  .object({
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
export type SaveSurveyQuestionsInput = z.infer<typeof saveSurveyQuestionsInput>;

/** 回答の送信入力。checkbox は string[]（サーバーで JSON 文字列に正規化して保存） */
export const submitSurveyAnswerItem = z.object({
  questionId: z.string(),
  value: z.union([z.string().max(500), z.array(z.string().max(500)).max(20)]),
});
export type SubmitSurveyAnswerItem = z.infer<typeof submitSurveyAnswerItem>;

export const submitSurveyAnswersInput = z.object({
  answers: z.array(submitSurveyAnswerItem).max(20),
});
export type SubmitSurveyAnswersInput = z.infer<typeof submitSurveyAnswersInput>;

/** 保存済みの回答（自分の回答・スタッフ閲覧共通）。checkbox は JSON array 文字列 */
export interface SurveyAnswer {
  questionId: string;
  value: string;
}

/** checkbox の保存値（JSON array 文字列）を配列に戻す。壊れていたら空配列 */
export function parseCheckboxValue(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** 表示・CSV 用: 保存値を人が読める1行にする（checkbox は「、」区切り） */
export function surveyValueLabel(qtype: SurveyQtype, value: string): string {
  return qtype === "checkbox" ? parseCheckboxValue(value).join("、") : value;
}

export interface SurveyTemplateQuestion {
  question: string;
  qtype: SurveyQtype;
  options: string[];
  required: boolean;
}

export interface SurveyTemplate {
  key: string;
  name: string;
  questions: SurveyTemplateQuestion[];
}

/**
 * 事前アンケートのテンプレート（編集画面のたたき台）。
 *
 * **`name` は辞書 (`eventForm.surveyTemplateName_<key>`) が訳す**が、`questions` の
 * 中身（質問文・選択肢）は日本語のまま。訳し忘れではない (#363):
 * テンプレを選ぶと**その文言がそのまま主催者のアンケートとして保存される**ので、
 * ここを見ている人の言語で訳すと、保存されたあとに「作った人と参加者で
 * 見える文言が違う」ことになる。保存されるデータの言語をどう扱うかは **#364**
 * で別途決める。決まるまでは中身に手を入れないこと。
 */
export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    key: "entry-info",
    name: "入館情報",
    questions: [
      { question: "氏名", qtype: "text", options: [], required: true },
      { question: "所属・会社名", qtype: "text", options: [], required: false },
    ],
  },
  {
    key: "party",
    name: "懇親会",
    questions: [
      {
        question: "懇親会に参加しますか",
        qtype: "select",
        options: ["参加", "不参加"],
        required: true,
      },
      {
        question: "食物アレルギー・食事制限",
        qtype: "text",
        options: [],
        required: false,
      },
    ],
  },
  {
    key: "attributes",
    name: "参加者属性",
    questions: [
      {
        question: "属性・職種",
        qtype: "select",
        options: [
          "エンジニア",
          "デザイナー",
          "プロダクトマネージャー",
          "経営・アントレプレナー",
          "学生",
          "その他",
        ],
        required: true,
      },
      {
        question: "このテーマの知識レベル",
        qtype: "select",
        options: ["初めて", "入門レベル", "実務経験あり", "専門・エキスパート"],
        required: false,
      },
      {
        question: "興味のある分野（複数選択可）",
        qtype: "checkbox",
        options: [
          "AI・機械学習",
          "Web開発",
          "モバイル",
          "インフラ・クラウド",
          "デザイン・UX",
          "ビジネス・起業",
        ],
        required: false,
      },
    ],
  },
];
