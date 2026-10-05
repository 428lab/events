import { z } from "zod";
import { normalizeLanguage, DEFAULT_LANGUAGE, type AppLanguage } from "./i18n/languages.js";

/** 参加アンケート (#152) のフェーズ。'pre'=参加登録時、'post'=事後アンケート (#153 予約) */
export const SURVEY_PHASES = ["pre", "post"] as const;
export type SurveyPhase = (typeof SURVEY_PHASES)[number];

/** 質問の回答形式 */
export const SURVEY_QTYPES = ["text", "select", "checkbox"] as const;
export type SurveyQtype = (typeof SURVEY_QTYPES)[number];

/** 主催者が1スイッチで足せる定型の質問。文言は表示側が閲覧者の言語の辞書で出す */
export const SURVEY_PRESETS = ["no_photo"] as const;
export type SurveyPreset = (typeof SURVEY_PRESETS)[number];

/** 写真NG（No photo）の保存値。言語に依存しない固定値で、表示は辞書が訳す */
export const NO_PHOTO_VALUES = ["ok", "no_photo"] as const;
export type NoPhotoValue = (typeof NO_PHOTO_VALUES)[number];

/** プリセット質問の保存形（質問文はDB上の目印。画面とCSVは辞書の文言を出す） */
export const SURVEY_PRESET_QUESTIONS: Record<SurveyPreset, {
  question: string; qtype: SurveyQtype; options: string[]; required: boolean;
}> = {
  no_photo: {
    question: "写真への写り込みを避けたいですか？",
    qtype: "select",
    options: [...NO_PHOTO_VALUES],
    required: true,
  },
};

/** 写真NGの文言。画面の辞書 (`eventForm.noPhoto*`) もここを引くので、
 * 辞書を丸ごと読み込まないサーバー（CSV）と同じ綴りになる */
export const NO_PHOTO_TEXT: Record<AppLanguage, { question: string; ok: string; no_photo: string }> = {
  ja: { question: "写真への写り込みを避けたいですか？", ok: "撮影OK", no_photo: "写真NG（No photo）" },
  en: { question: "Do you prefer not to be photographed?", ok: "Photos OK", no_photo: "No photo" },
};

/** 質問文を閲覧者の言語で。プリセット以外は主催者が書いた文言のまま */
export function surveyQuestionText(
  q: Pick<SurveyQuestion, "question" | "preset">,
  language: string | null | undefined,
): string {
  if (q.preset !== "no_photo") return q.question;
  return NO_PHOTO_TEXT[normalizeLanguage(language) ?? DEFAULT_LANGUAGE].question;
}

/** 保存値を閲覧者の言語の1行に（プリセットは固定値を訳す。それ以外は surveyValueLabel） */
export function surveyAnswerText(
  q: Pick<SurveyQuestion, "qtype" | "preset">,
  value: string,
  language: string | null | undefined,
): string {
  if (q.preset === "no_photo" && (NO_PHOTO_VALUES as readonly string[]).includes(value)) {
    return NO_PHOTO_TEXT[normalizeLanguage(language) ?? DEFAULT_LANGUAGE][value as NoPhotoValue];
  }
  return surveyValueLabel(q.qtype, value);
}

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
  /** 定型の質問なら種類。通常の質問は null */
  preset: z.enum(SURVEY_PRESETS).nullable(),
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
/** 定型の質問の保存入力。文言・形式・必須はサーバーが固定値で決める
 * （送られてきた question / required などは捨てる。union の先頭に置くので preset 付きは必ずこちら） */
export const saveSurveyPresetItem = z.object({
  id: z.string().optional(),
  preset: z.enum(SURVEY_PRESETS),
});
export type SaveSurveyPresetItem = z.infer<typeof saveSurveyPresetItem>;
export type SaveSurveyQuestionItem =
  | z.infer<typeof saveSurveyQuestionItem>
  | SaveSurveyPresetItem;

/** 質問の一括保存入力（並び順は配列順）。select/checkbox は選択肢必須、プリセットは各1問まで */
export const saveSurveyQuestionsInput = z
  .object({
    questions: z
      .array(z.union([saveSurveyPresetItem, saveSurveyQuestionItem]))
      .max(20),
  })
  .superRefine((v, ctx) => {
    const presets = v.questions.flatMap((q) => ("preset" in q ? [q.preset] : []));
    if (new Set(presets).size !== presets.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate_preset",
        path: ["questions"],
      });
    }
    v.questions.forEach((q, i) => {
      if (
        !("preset" in q) &&
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
