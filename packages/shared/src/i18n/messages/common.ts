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
};

export const common = { ja, en };
