/**
 * 問い合わせの文言 (#357)。
 *
 * 対象は利用者側の問い合わせ一覧・スレッド画面と、運営側でも使う
 * スレッド部品（`InquiryThread`）。
 *
 * 見出しの「お問い合わせ」は `nav.inquiries` にあるのでここには持たない。
 * 状態のラベルは下の `inquiryStatus`（コード別の表）に分けてある。
 */
import type { InquiryStatus } from "../../inquiries.js";

const ja = {
  /** 新しい問い合わせを書き始める導線と、その入力欄 */
  create: "新規問い合わせ",
  subject: "件名",
  body: "内容",
  /** 送信ボタン。新規作成とスレッドへの返信の両方で使う */
  send: "送信",
  sendError: "送信に失敗しました。",

  /** 一覧 */
  empty: "お問い合わせはまだありません。ご質問・ご要望はお気軽にどうぞ。",
  lastUpdated: "最終更新 {{time}}",

  /** スレッド */
  notFound: "お問い合わせが見つかりません。",
  backToList: "← お問い合わせ一覧へ",
  replyPlaceholder: "返信を入力…",

  /** 発言者の肩書き。利用者側と運営側で同じ部品を使うので、
   *  「あなた」は見ている側によって指す人が変わる */
  senderYou: "あなた",
  senderAdmin: "運営",
  /** 運営から見た相手。名前が分からないときだけ出る */
  senderUser: "ユーザー",
} as const;

const en: Record<keyof typeof ja, string> = {
  create: "New inquiry",
  subject: "Subject",
  body: "Message",
  send: "Send",
  sendError: "Couldn't send your message.",

  empty: "No inquiries yet. Feel free to ask us anything.",
  lastUpdated: "Updated {{time}}",

  notFound: "This inquiry could not be found.",
  backToList: "← Back to inquiries",
  replyPlaceholder: "Write a reply…",

  senderYou: "You",
  senderAdmin: "Support",
  senderUser: "User",
};

/**
 * 問い合わせの状態 (`InquiryStatus`) 別のラベル。
 *
 * コードがそのままキーなので、テンプレートリテラルで型のまま引ける
 * （リテラル union なので `tDynamic` は要らない）。
 */
const statusJa: Record<InquiryStatus, string> = {
  open: "対応中",
  answered: "回答済み",
  closed: "クローズ",
};

const statusEn: Record<keyof typeof statusJa, string> = {
  open: "In progress",
  answered: "Answered",
  closed: "Closed",
};

export const inquiries = { ja, en };
export const inquiryStatus = { ja: statusJa, en: statusEn };
