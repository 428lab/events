/**
 * お知らせの文言 (#357)。
 *
 * 対象はお知らせ一覧 (#294) と通知ベルのポップオーバー。
 *
 * **種別のラベル（「抽選」「イベントからの連絡」など）はここには置かない**。
 * 日本語は `NOTIFICATION_TYPE_LABELS`（notifications.ts）が source で、
 * 訳は `labels.ts` 経由の `notificationType` 名前空間にある。
 * 見出しの「お知らせ」と、ベル下部の「お問い合わせ」も `nav.*` にあるので
 * ここには持たない（同じ文言を2か所に増やさない）。
 */
const ja = {
  /** 一覧の冒頭で、この画面が何を出す場所かを伝える */
  description:
    "受け取ったお知らせが新しい順に並びます。日付で自動的に消えることはありません。ここに出るのはあなた宛てのお知らせだけです。",

  /** 1件ごとの印と操作 */
  unread: "未読",
  markRead: "既読にする",
  open: "開く",

  /** 未読があるときだけ出る。一覧とベルの両方で使う */
  markAllRead: "すべて既読",

  /** 一覧の件数表示。未読があるときだけ countUnread を後ろにつなぐので、
   *  区切りの「 / 」は countUnread の先頭に入っている */
  countTotal: "全 {{n}} 件",
  countUnread: " / 未読 {{n}} 件",

  /** 0件のとき。一覧とベルで言い方が違う（一覧は「まだ」溜まっていないの意） */
  empty: "お知らせはまだありません。",
  bellEmpty: "お知らせはありません",

  /** ベルの下部から一覧へ */
  bellSeeAll: "お知らせ一覧",
} as const;

const en: Record<keyof typeof ja, string> = {
  description:
    "Your notifications appear here, newest first. Nothing is removed automatically. Only notifications addressed to you are shown.",

  unread: "Unread",
  markRead: "Mark as read",
  open: "Open",

  markAllRead: "Mark all as read",

  countTotal: "{{n}} total",
  countUnread: " / {{n}} unread",

  empty: "No notifications yet.",
  bellEmpty: "No notifications",

  bellSeeAll: "All notifications",
};

export const notifications = { ja, en };
