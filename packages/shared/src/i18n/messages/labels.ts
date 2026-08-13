/**
 * すでに1か所にまとまっていたラベルの英語版 (#352)。
 *
 * 日本語はもとの定数をそのまま source にする（コピーして2か所に増やさない）。
 * `ABUSE_RULE_LABELS` などはサーバー側（検知バッチの通知本文）でも使っており、
 * サーバーから出る文言の言語対応は後の段階なので、定数自体は日本語のまま残す。
 */
import {
  ABUSE_RULE_DESCRIPTIONS,
  ABUSE_RULE_LABELS,
  type AbuseRule,
} from "../../abuse.js";
import {
  NOTIFICATION_TYPE_LABELS,
  type NotificationType,
} from "../../notifications.js";
import type { EventRole, VenueType } from "../../constants.js";

/** イベント内での立場（もとは apps/web/src/lib/format.ts の roleLabel） */
const roleJa: Record<EventRole, string> = {
  participant: "参加者",
  staff: "スタッフ",
  judge: "審査員",
  observer: "観覧者",
};
const roleEn: Record<EventRole, string> = {
  participant: "Participant",
  staff: "Organizer",
  judge: "Judge",
  observer: "Viewer",
};

/** 開催形態（もとは apps/web/src/lib/format.ts の venueLabel）。
 *  名前空間は `venueType`。会場そのものの文言は `venue`（messages/venue.ts） */
const venueJa: Record<VenueType, string> = {
  offline: "オフライン",
  online: "オンライン",
  hybrid: "ハイブリッド",
};
const venueEn: Record<VenueType, string> = {
  offline: "In person",
  online: "Online",
  hybrid: "Hybrid",
};

/** お知らせの種別（日本語は packages/shared/src/notifications.ts が source） */
const notificationTypeEn: Record<NotificationType, string> = {
  lottery_won: "Lottery",
  lottery_lost: "Lottery",
  waitlist_promoted: "Registration",
  award: "Awards",
  inquiry_reply: "Support",
  inquiry_new: "Support",
  schedule_finalized: "Schedule",
  // 日本語の source が「リクエスト」なので、綴りを合わせて "Request" のまま。
  // たまごの呼び名（#378 の "egg"）に寄せるなら日本語側から直す話になる
  request_event_created: "Request",
  followee_created_event: "Following",
  followee_joined_event: "Following",
  venue_offer: "Venue",
  venue_offer_result: "Venue",
  venue_photo_result: "Venue",
  survey_reminder: "Survey",
  meet: "Meet",
  abuse_flag: "Operations",
  event_broadcast: "Event announcement",
  staff_invite: "Organizer invite",
  staff_invite_result: "Organizer invite",
  info: "Notice",
};

/** 要確認ルール（日本語は packages/shared/src/abuse.ts が source） */
const abuseRuleEn: Record<AbuseRule, string> = {
  event_burst: "Many events created in a short time",
  egg_burst: "Many eggs posted in a short time",
  comment_burst: "Many comments and likes in a short time",
  new_account_burst: "New account acting in bulk right away",
  empty_event_spam: "Repeated events with no participants",
  cancel_burst: "Many cancellations",
  signup_spike: "Spike in new sign-ups (service-wide)",
};
const abuseRuleDescriptionEn: Record<AbuseRule, string> = {
  event_burst: "An unusually high number of events created in a short window.",
  egg_burst: "An unusually high number of eggs posted in a short window.",
  comment_burst: "An unusually high number of comments and likes per hour.",
  new_account_burst: "Events created in bulk right after signing up.",
  empty_event_spam:
    "Events that still have no applicants two or more days after being published.",
  cancel_burst:
    "A high number and share of cancellations over the last seven days.",
  signup_spike: "Daily sign-ups well above the recent average.",
};

export const labels = {
  ja: {
    role: roleJa,
    venueType: venueJa,
    notificationType: NOTIFICATION_TYPE_LABELS,
    abuseRule: ABUSE_RULE_LABELS,
    abuseRuleDescription: ABUSE_RULE_DESCRIPTIONS,
  },
  en: {
    role: roleEn,
    venueType: venueEn,
    notificationType: notificationTypeEn,
    abuseRule: abuseRuleEn,
    abuseRuleDescription: abuseRuleDescriptionEn,
  },
};
