/** ログイン後のホーム（ダッシュボード）の文言 (#489) */
const ja = {
  /** 見出し */
  liveNow: "開催中",
  next: "次のイベント",
  upcoming: "このあとの予定",
  scheduling: "日程調整中",
  todo: "要対応",


  /** 当日の導線 */
  openEvent: "イベントを開く",

  /** 要対応。0件のときは見出しごと出さない */
  staffInvites: "運営への招待が {{n}} 件あります",
  staffInvitesAction: "返事をする",

  /** まだ何も参加していない人向け */
  emptyTitle: "参加予定のイベントはまだありません",
  emptyBody:
    "気になるイベントを探して参加するか、自分でイベントを立ててみましょう。",
  emptyBrowse: "イベントを探す",
  emptyCreate: "イベントを作る",

  /** 予定の取得に失敗したとき。「予定なし」と誤案内しない */
  loadError: "参加予定を読み込めませんでした。",
  reload: "再読み込み",
} as const;

const en: Record<keyof typeof ja, string> = {
  liveNow: "Happening now",
  next: "Your next event",
  upcoming: "Coming up",
  scheduling: "Picking a date",
  todo: "Needs your reply",


  openEvent: "Open event",

  staffInvites: "You have {{n}} organizer invitation(s)",
  staffInvitesAction: "Reply",

  emptyTitle: "You have no upcoming events yet",
  emptyBody: "Find an event to join, or host one of your own.",
  emptyBrowse: "Browse events",
  emptyCreate: "Create an event",

  loadError: "Couldn't load your upcoming events.",
  reload: "Reload",
};

export const home = { ja, en };
