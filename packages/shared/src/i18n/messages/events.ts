/**
 * イベント一覧まわりの文言 (#352)。
 *
 * 対象は一覧の見出し・タブ・絞り込み・カード・フィード購読の導線。
 * イベント詳細は `eventDetail.ts` が持つ。
 *
 * 日時・人数・立場・開催形態の並べ方は `common.ts` と `labels.ts` にあるので
 * ここには置かない（同じ文言を2か所に増やさない）。
 */
const ja = {
  /** 一覧の見出し（既定） */
  title: "イベント",

  /** 開催予定 / 日程調整中 / 過去 のタブ */
  tabUpcoming: "開催予定",
  tabScheduling: "日程調整中",
  tabPast: "過去",

  /** 絞り込みパネルの開閉（文字とアイコンの両方で同じ言い方をする） */
  filter: "絞り込み",
  filterKeyword: "キーワード",
  filterKeywordPlaceholder: "イベント名・内容で検索",
  filterFrom: "開始日（以降）",
  filterTo: "終了日（まで）",
  filterCommunity: "コミュニティ",
  filterCommunityAll: "すべて",
  clearFilters: "条件をクリア",

  /** 並び替え */
  sort: "並び替え",
  sortSoon: "開催日が近い順",
  sortRecent: "開催日が新しい順",
  sortNew: "登録が新しい順",

  /** 絞り込み中の件数 */
  matchCount: "条件に一致: {{n}}件",

  /** 0件のときの案内。絞り込み中かタブかで言い分ける */
  emptyFiltered: "条件に合うイベントはありません。",
  emptyUpcoming: "予定されているイベントはありません。",
  emptyScheduling: "日程調整中のイベントはありません。",
  emptyPast: "過去のイベントはありません。",

  /** 短いシェアURL (/e/:slug) から辿れなかったとき (#366)。たまごの
   *  `egg.notFoundShort` と対になる（片方だけ訳すと同じ形の2画面で割れる） */
  notFound: "イベントが見つかりません。",

  /** 読み込みに失敗したとき（サーバーがコードを返さないときの言い方） */
  loadError: "イベントを読み込めませんでした。再読み込みしてください。",

  /** 一覧からイベントを作る導線 */
  create: "イベント作成",

  /** 1列⇔2列の表示切替（アイコンだけなので読み上げ用の名前が要る） */
  columns: "表示列数",
  columnsOne: "1列表示",
  columnsTwo: "2列表示",

  /** カードで開催日時の代わりに出す印 */
  schedulingBadge: "日程調整中",
  /** 公開前であることを示す印。一覧カードでも年表でも同じ印を出す (#348) */
  draftBadge: "下書き",
  /** 横型カードで日時のうしろに並べる開催形態と人数（区切りは言語で変わる） */
  cardMeta: "・ {{venue}} ・ {{participants}}",

  /** フィード購読の導線 */
  feedSubscribe: "イベント一覧をフィードで購読:",
  feedIcs: "カレンダー(.ics)",
  feedIcsHint: "カレンダーアプリで購読できます",
  feedLlms: "AI向け(llms.txt)",
  feedLlmsHint: "AIエージェント向けにフィードとクエリ仕様をまとめた llms.txt",
} as const;

const en: Record<keyof typeof ja, string> = {
  title: "Events",

  tabUpcoming: "Upcoming",
  tabScheduling: "Date TBD",
  tabPast: "Past",

  filter: "Filter",
  filterKeyword: "Keyword",
  filterKeywordPlaceholder: "Search event names and details",
  filterFrom: "Starts on or after",
  filterTo: "Ends on or before",
  filterCommunity: "Community",
  filterCommunityAll: "All",
  clearFilters: "Clear filters",

  sort: "Sort by",
  sortSoon: "Soonest first",
  sortRecent: "Most recent first",
  sortNew: "Recently listed first",

  matchCount: "{{n}} events match",

  emptyFiltered: "No events match these filters.",
  emptyUpcoming: "No upcoming events yet.",
  emptyScheduling: "No events are picking a date right now.",
  emptyPast: "No past events yet.",

  notFound: "This event could not be found.",

  loadError: "Couldn't load events. Please reload the page.",

  create: "Create event",

  columns: "Number of columns",
  columnsOne: "Single column",
  columnsTwo: "Two columns",

  schedulingBadge: "Date TBD",
  draftBadge: "Draft",
  cardMeta: "· {{venue}} · {{participants}}",

  feedSubscribe: "Subscribe to these events:",
  feedIcs: "Calendar (.ics)",
  feedIcsHint: "Subscribe from your calendar app",
  feedLlms: "For AI (llms.txt)",
  feedLlmsHint: "llms.txt — feeds and query reference for AI agents",
};

export const events = { ja, en };
