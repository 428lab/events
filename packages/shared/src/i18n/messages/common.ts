/**
 * どの画面からも使う短い文言と、日時・人数の並べ方 (#352)。
 *
 * 日時そのものの書式は Intl に任せる（ロケールだけ切り替える）。ここに置くのは
 * 「開始 〜 終了」のように **言語で並べ方が変わる型** だけ。
 */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
const ja = {
  /** 開始と終了のつなぎ。日時そのものは Intl が組み立てる */
  dateRange: "{{start}} 〜 {{end}}",
  /** 締切までの残り。粒度は粗くてよい (#269) */
  remainingHours: "あと{{n}}時間",
  remainingMinutes: "あと{{n}}分",
  /** 人数表示 (#297) */
  participants: "参加 {{n}} 人",
  participantsOfCapacity: "参加 {{n}} / {{total}} 人",
  participantsWithAttended: "{{base}}・出席 {{n}} 人",

  /** お知らせベルの相対時刻 */
  justNow: "たった今",
  minutesAgo: "{{n}}分前",
  hoursAgo: "{{n}}時間前",
  daysAgo: "{{n}}日前",

  loading: "読み込み中…",
  save: "保存",
  cancel: "キャンセル",
  close: "閉じる",
  back: "戻る",
  retry: "もう一度",
  search: "検索",

  /** 並べ替えの矢印ボタン (#363)。参加枠・事前アンケート・スケジュールの
   *  どれも同じ言い方なので、領域ごとに持たせない */
  moveUp: "上へ移動",
  moveDown: "下へ移動",

  /** 直前の操作を取り消す (#363)。QR受付と出会いの記録の両方から引く */
  undo: "取り消す",
  /** 一覧に項目を足すボタン (#363)。参加枠・採点項目のどちらも同じ言い方 */
  add: "追加",
  /** テンプレから作り始める導線 (#363)。タイムテーブルと事前アンケートで共通 */
  fromTemplate: "テンプレから作成",
  /** 書いたものを送るボタン (#363)。問い合わせとチャットで共通 */
  send: "送信",
  /** 本文に埋め込んだ動画の読み上げ名 (#363)。Markdown はイベント・会場・
   *  コミュニティのどの説明からも使う共有部品なので、領域に寄せない */
  youtubeEmbedTitle: "YouTube動画",
  /** 名前を後ろに添えるときの括弧 (#363)。和文と欧文で記号と前の空きが違う */
  parenName: "（{{name}}）",
  /** 件名の入力欄 (#363)。問い合わせと一斉連絡の両方から引く */
  subject: "件名",

  /** シェアボタン (#357)。イベント・たまご・プロフィールのどこからでも使う */
  share: "シェア",
  shareCopy: "シェアリンクをコピー",
  shareCopied: "リンクをコピーしました: {{url}}",
  /** クリップボードが使えない環境の逃げ道（window.prompt の見出し） */
  sharePrompt: "このURLをコピーしてください",

  /** 短い項目を横に並べるときの区切り。和文と欧文で記号が違う (#357) */
  dotSeparator: " ・ ",
  /** 公開プロフィールへの導線。設定・QR読み取りの両方から引く (#357) */
  viewProfile: "プロフィールを見る",
} as const;

const en: Record<keyof typeof ja, string> = {
  dateRange: "{{start}} – {{end}}",
  remainingHours: "{{n}}h left",
  remainingMinutes: "{{n}}m left",
  participants: "{{n}} joined",
  participantsOfCapacity: "{{n}} / {{total}} joined",
  participantsWithAttended: "{{base}} · {{n}} attended",

  justNow: "Just now",
  minutesAgo: "{{n}}m ago",
  hoursAgo: "{{n}}h ago",
  daysAgo: "{{n}}d ago",

  loading: "Loading…",
  save: "Save",
  cancel: "Cancel",
  close: "Close",
  back: "Back",
  retry: "Try again",
  search: "Search",

  moveUp: "Move up",
  moveDown: "Move down",

  undo: "Undo",
  add: "Add",
  fromTemplate: "Start from a template",
  send: "Send",
  youtubeEmbedTitle: "YouTube video",
  parenName: " ({{name}})",
  subject: "Subject",

  share: "Share",
  shareCopy: "Copy the share link",
  shareCopied: "Link copied: {{url}}",
  sharePrompt: "Copy this URL",

  dotSeparator: " · ",
  viewProfile: "View profile",
};

export const common = { ja, en };
