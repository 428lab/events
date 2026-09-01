/**
 * 開催前アンケート (#444) の回答ページの文言。
 *
 * 回答者は未ログインの初見の人が多い。**イベント本体の情報はここに出ない**
 * （出すものは主催者が書いたタイトル・説明だけ）ので、文言も「このアンケート」
 * より外を指さない言い方にする。
 */
const ja = {
  /** 見出し・状態 */
  notFound: "アンケートが見つかりません。URLをお確かめください。",
  closed: "このアンケートは締め切られました。",
  required: "必須",

  /** 送信 */
  submit: "回答を送信",
  submitting: "送信しています…",
  submitFailedRequired: "必須の質問に回答してください。",
  submitFailedClosed: "このアンケートは締め切られました。",
  submitFailedFull: "回答の受付上限に達しました。",
  submitFailed: "送信に失敗しました。もう一度お試しください。",

  /** 完了画面（送信1回きり。編集はできない） */
  doneHeading: "回答を送信しました",
  doneNote: "ご協力ありがとうございます。この画面を閉じて構いません。",

  /** 自由記述のプレースホルダ */
  textPlaceholder: "自由にご記入ください",
} as const;

const en: Record<keyof typeof ja, string> = {
  notFound: "Survey not found. Please check the URL.",
  closed: "This survey is closed.",
  required: "Required",

  submit: "Submit",
  submitting: "Submitting…",
  submitFailedRequired: "Please answer the required questions.",
  submitFailedClosed: "This survey is closed.",
  submitFailedFull: "This survey has reached its response limit.",
  submitFailed: "Failed to submit. Please try again.",

  doneHeading: "Response submitted",
  doneNote: "Thank you! You can close this page.",

  textPlaceholder: "Write freely",
};

export const preSurvey = { ja, en };
