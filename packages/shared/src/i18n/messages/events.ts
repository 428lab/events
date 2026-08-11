/** イベント一覧・イベントカードの文言 (#352) */
const ja = {
  title: "イベント",
  empty: "イベントはまだありません",
  upcoming: "これから",
  past: "終了",
  mine: "参加中",
  create: "イベントを作る",
  draft: "下書き",
} as const;

const en: Record<keyof typeof ja, string> = {
  title: "Events",
  empty: "No events yet",
  upcoming: "Upcoming",
  past: "Past",
  mine: "Joined",
  create: "Create an event",
  draft: "Draft",
};

export const events = { ja, en };
