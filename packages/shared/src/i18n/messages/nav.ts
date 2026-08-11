/**
 * ヘッダーとメニューの文言 (#352)。
 *
 * `admin.*` は運営管理者向けの項目。ダッシュボード本体 (/admin/*) は対象外だが、
 * **入口はヘッダー（一般画面と同じ部品）にある**ので、ここだけは訳す。
 */
const ja = {
  communities: "コミュニティ",
  venues: "会場",
  decks: "スライド",
  liveSets: "配信",
  settings: "設定",
  notifications: "お知らせ",
  inquiries: "お問い合わせ",
  logout: "ログアウト",
  menu: "メニュー",
  myProfile: "自分のプロフィール",
  staffInvites: "運営への招待 {{n}} 件",
  adminBadge: "運営管理者",
  operations: "運用",
  operationsBreakdown: "問い合わせ未読 {{inquiries}} 件 / 要確認 {{abuse}} 件",
  adminInquiries: "問い合わせ管理",
  adminSettings: "運用設定",
  adminKpi: "KPI",
  adminTrending: "注目",
  adminStats: "統計",
  adminAbuse: "要確認",
  adminModeration: "コンテンツの対処",
  adminAudit: "監査ログ",
} as const;

const en: Record<keyof typeof ja, string> = {
  communities: "Communities",
  venues: "Venues",
  decks: "Slides",
  liveSets: "Broadcast",
  settings: "Settings",
  notifications: "Notifications",
  inquiries: "Support",
  logout: "Sign out",
  menu: "Menu",
  myProfile: "My profile",
  staffInvites: "{{n}} organizer invites",
  adminBadge: "Service admin",
  operations: "Operations",
  operationsBreakdown: "{{inquiries}} unread inquiries / {{abuse}} to review",
  adminInquiries: "Inquiries",
  adminSettings: "Operations settings",
  adminKpi: "KPI",
  adminTrending: "Trending",
  adminStats: "Stats",
  adminAbuse: "To review",
  adminModeration: "Content actions",
  adminAudit: "Audit log",
};

export const nav = { ja, en };
