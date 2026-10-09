/**
 * イベントの主催者への問い合わせの文言 (D-EVENT-CONTACT)。
 *
 * 送る側（イベントのページのボタンとダイアログ、お問い合わせ一覧・スレッドのイベント表示）と、
 * 主催者側（イベントの管理メニューの「問い合わせ」ページ）で使う。
 * 状態のラベルは運営あての問い合わせと同じ `inquiryStatus` を使う。
 */
const ja = {
  /** イベントのページの導線 */
  ask: "主催者に問い合わせる",
  loginToAsk: "ログインして問い合わせる",
  /** 送るダイアログ */
  dialogTitle: "主催者への問い合わせ",
  dialogNote: "このイベントのスタッフに届きます。返事はお問い合わせ一覧とベル通知でお知らせします。",
  subjectPlaceholder: "件名（空欄ならイベント名）",
  bodyPlaceholder: "問い合わせ内容",
  send: "送る",
  tooMany: "このイベントへの未完了の問い合わせが多すぎます。返事を待ってからにしてください。",
  /** お問い合わせ一覧・スレッドでのイベント表示 */
  eventLabel: "イベント: {{title}}",
  threadHeader: "{{title}} の主催者への問い合わせ",
  /** スレッドで、主催者側（確定スタッフ）の発言に付く肩書き */
  organizer: "主催者",
  /** 主催者側のページ */
  manageTitle: "問い合わせ",
  staffOnly: "このページはイベントのスタッフだけが使えます。",
  empty: "まだ問い合わせはありません。",
  backToList: "← 問い合わせ一覧へ",
  markDone: "完了にする",
  markDoneFailed: "完了にできませんでした。",
} as const;

const en: Record<keyof typeof ja, string> = {
  ask: "Contact the organizer",
  loginToAsk: "Log in to contact the organizer",
  dialogTitle: "Contact the organizer",
  dialogNote: "Your message goes to this event's staff. You'll find replies in your inquiries and in notifications.",
  subjectPlaceholder: "Subject (event title if left empty)",
  bodyPlaceholder: "Your question",
  send: "Send",
  tooMany: "You have too many open inquiries for this event. Please wait for a reply first.",
  eventLabel: "Event: {{title}}",
  threadHeader: "Inquiry to the organizer of {{title}}",
  organizer: "Organizer",
  manageTitle: "Inquiries",
  staffOnly: "Only this event's staff can use this page.",
  empty: "No inquiries yet.",
  backToList: "← Back to inquiries",
  markDone: "Mark as done",
  markDoneFailed: "Couldn't mark this inquiry as done.",
};

export const eventInquiry = { ja, en };
