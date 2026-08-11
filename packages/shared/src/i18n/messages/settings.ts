/**
 * 設定ページの文言 (#354)。
 *
 * いまは表示言語の項目だけ。設定ページの既存の項目（利用者名・通知・ログイン方法
 * など）の翻訳は #352 の第2段階でここに足していく。
 *
 * 言語そのものの呼び名（日本語 / English）はここには置かない。どの言語で
 * 表示しても同じ綴りで出すので `LANGUAGE_NAMES`（languages.ts）が出所。
 */
const ja = {
  languageTitle: "表示言語",
  languageDescription:
    "画面の表示言語を選べます。選んだ言語はこの端末にだけ残り、ほかの端末には影響しません。",
  languageAuto: "自動",
  languageAutoDescription: "「自動」はブラウザの言語に合わせます。",
} as const;

const en: Record<keyof typeof ja, string> = {
  languageTitle: "Display language",
  languageDescription:
    "Choose the language of the interface. Your choice stays on this device only and does not affect your other devices.",
  languageAuto: "Automatic",
  languageAutoDescription: "“Automatic” follows your browser’s language.",
};

export const settings = { ja, en };
