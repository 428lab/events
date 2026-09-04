/**
 * 運営スタッフの招待 (#339)。自分宛の招待の一覧と、イベント側の招待カード。
 *
 * 理由コード別の案内 (`staffInviteError`) と状態の表 (`staffInviteStatus`) も
 * ここが持つ。状態の**日本語はもとの定数が source**（書き写さない）。
 */
import {
  STAFF_INVITE_STATUS_LABELS,
  type StaffInviteStatus,
} from "../../../staffInvites.js";

const ja = {
  /* ── 自分宛の運営への招待 (#339) ────────────────────────── */
  myInvitesTitle: "運営への招待",
  myInvitesIntro:
    "承諾すると、そのイベントの運営として準備や当日の操作ができるようになります。断ることもできます。",
  myInvitesEmpty: "返事待ちの招待はありません。",
  invitePreRelease: "公開前",
  inviteScheduleTbd: "開催日時は調整中",
  inviteFrom: "{{name}} さんからの招待",
  inviteDraftNotice:
    "このイベントはまだ公開されていません。承諾すると内容を見て、準備を一緒に進められます。",
  inviteSlotWarning:
    "いま申し込んでいる参加枠は外れます。運営は参加枠を使わずに参加するためで、あとから運営を降りても申し込みは戻りません（先着枠は他の人が繰り上がります）。",
  inviteSlotNote:
    "すでに参加を申し込んでいる場合、参加枠は外れて運営として参加します。",
  inviteAccept: "承諾して運営になる",
  inviteDecline: "断る",
  inviteDeclineConfirm: "「{{title}}」の運営への招待を断りますか？",

  /* ── イベント側の招待カード (#339) ─────────────────────── */
  inviteStaffTitle: "運営に招く",
  inviteStaffIntro:
    "指名して招待します。相手が承諾すると運営になり、公開前でも一緒に準備できます。承諾するまでは運営ではありません。",
  inviteStaffField: "名前かユーザー名で招待",
  inviteStaffPlaceholder: "例: example_user",
  inviteStaffSend: "招待",
  inviteStaffEmpty: "招待はまだありません。",
  inviteStaffBy: "招待: {{name}}",
  /** 送った招待を取り下げる操作。状態の「取り消し」(staffInviteStatus.revoked)
   *  とは別物（あちらは済んだ状態、こちらはこれから押すボタン） */
  inviteStaffRevoke: "取り消し",
  inviteStaffRemoveRow: "一覧から消す",
  /** 入力候補の見出し。候補の出どころは英字のキーで持ち、表示のたびに訳す */
  inviteCandidateMembers: "このイベントの参加者",
  inviteCandidateFollowing: "フォロー中",
  /** 理由コードが表に無いときの受け皿。コード別の文言は staffInviteError */
  inviteErrorDefault: "処理できませんでした。時間をおいて試してください。",
} as const;

const en: Record<keyof typeof ja, string> = {
  myInvitesTitle: "Organizer invitations",
  myInvitesIntro:
    "Once you accept, you can help prepare the event and run it on the day. You can also decline.",
  myInvitesEmpty: "You have no invitations waiting for a reply.",
  invitePreRelease: "Not published",
  inviteScheduleTbd: "The date is still being decided",
  inviteFrom: "Invitation from {{name}}",
  inviteDraftNotice:
    "This event is not published yet. Accepting lets you see it and help get it ready.",
  inviteSlotWarning:
    "You will lose the participation slot you signed up for. Organizers take part without using a slot, and stepping down later does not bring your sign-up back (on first-come slots, someone else moves up right away).",
  inviteSlotNote:
    "If you have already signed up, your slot is released and you take part as an organizer.",
  inviteAccept: "Accept and become an organizer",
  inviteDecline: "Decline",
  inviteDeclineConfirm: "Decline the invitation to help organize “{{title}}”?",

  inviteStaffTitle: "Invite organizers",
  inviteStaffIntro:
    "Invite someone by name. They become an organizer once they accept, and can then help you prepare even before the event is published. Until they accept, they are not an organizer.",
  inviteStaffField: "Invite by name or username",
  inviteStaffPlaceholder: "e.g. example_user",
  inviteStaffSend: "Invite",
  inviteStaffEmpty: "No invitations yet.",
  inviteStaffBy: "Invited by {{name}}",
  inviteStaffRevoke: "Revoke",
  inviteStaffRemoveRow: "Remove from the list",
  inviteCandidateMembers: "Taking part in this event",
  inviteCandidateFollowing: "People you follow",
  inviteErrorDefault: "Something went wrong. Please try again later.",
};

export const invites = { ja, en };

/**
 * 運営スタッフの招待が断られた理由 (#339)。サーバーのエラーコードで引く表なので
 * キーはコードそのもの。共通の `errors` より一歩踏み込んで、その場で直せる形で書く。
 *
 * ここに無いコードは `staffOps.inviteErrorDefault` に落ちる。
 * 「返事待ちに戻せるか」のような**文言でない属性は持たない**。
 */
const inviteErrorJa = {
  user_not_found:
    "そのユーザー名の人が見つかりませんでした。プロフィールのユーザー名を確認してください。",
  self_invite: "自分自身は招待できません。",
  already_staff: "その人はすでに運営です。",
  already_invited:
    "その人にはすでに招待を送っています。返事を待つか、取り消してから送り直してください。",
  inviter_not_staff:
    "招待した人は、このイベントの運営ではなくなりました。必要なら別の運営から招待し直してもらってください。",
  not_pending: "この招待はすでに返事が済んでいます。画面を更新してください。",
  not_found: "対象が見つかりませんでした。画面を更新してください。",
} as const;

const inviteErrorEn: Record<keyof typeof inviteErrorJa, string> = {
  user_not_found:
    "No one with that username was found. Check the username on their profile.",
  self_invite: "You cannot invite yourself.",
  already_staff: "They are already an organizer.",
  already_invited:
    "You have already invited them. Wait for their reply, or revoke the invitation and send it again.",
  inviter_not_staff:
    "The person who invited you is no longer an organizer of this event. If you still want to join, ask another organizer to invite you again.",
  not_pending: "This invitation has already been answered. Please reload.",
  not_found: "That was not found. Please reload the page.",
};

/** 招待の状態。日本語はもとの定数 (`STAFF_INVITE_STATUS_LABELS`) が source */
const inviteStatusEn: Record<StaffInviteStatus, string> = {
  pending: "Waiting for a reply",
  accepted: "Accepted",
  declined: "Declined",
  revoked: "Revoked",
};

export const staffInviteError = { ja: inviteErrorJa, en: inviteErrorEn };
export const staffInviteStatus = {
  ja: STAFF_INVITE_STATUS_LABELS,
  en: inviteStatusEn,
};
