/**
 * 一斉連絡 (#172)。送信先区分の表 (`broadcastSegment` /
 * `broadcastSegmentNote`) もここが持つ。
 *
 * 区分の**日本語はもとの定数が source**。英語だけを足す（2か所に増やすと
 * 必ず片方が古くなる）。
 */
import {
  BROADCAST_OVERLAP_NOTE,
  BROADCAST_SEGMENT_LABELS,
  BROADCAST_SEGMENT_NOTES,
  type BroadcastSegment,
} from "../../../eventBroadcast.js";

const ja = {
  /* ── 一斉連絡 (#172)。見出しは eventDetail.broadcast ────────── */
  broadcastStaffOnly: "一斉連絡はスタッフ専用です。",
  broadcastIntro:
    "送信先の区分を選んでお知らせを送ります。アプリ内のお知らせはすぐに届きます。メールは順番に送るため、送りきるまで1時間あたり{{perHour}}通ほどのペースになります（100人なら{{eta100}}、300人なら{{eta300}}）。他のイベントの一斉連絡と同時に送信待ちがあるときは、順番を分け合うためさらに時間がかかることがあります。急ぎの連絡はアプリ内のお知らせが先に届きます。",
  broadcastSegmentField: "送信先",
  broadcastSegmentOption: "{{label}}（{{n}} 人）",
  broadcastCountNote:
    "人数は実際に届く人数です。送ったものはこのページの履歴で読めるので、自分あてには届きません。",
  broadcastTitleHelp: "お知らせの見出しになります",
  broadcastBodyField: "本文",
  broadcastBodyHelp: "送信後は取り消せません",
  broadcastNoUndoWarning:
    "送信後は取り消せません。届いたお知らせやメールを消すことはできません。",
  broadcastConfirmOpen: "送信内容を確認",
  broadcastRemaining:
    "今日はあと {{today}} 回 ／ このイベントで通算あと {{total}} 回 送れます",
  /** 上限に達したときの案内。24時間の上限は「送る前の注意」と「断られた理由」で
   *  同じ文なので1つのキーを両方から引く */
  broadcastLimitTotalNotice:
    "このイベントで送れる回数（通算）を使い切りました。時間をおいても増えません。",
  broadcastLimitDayNotice:
    "24時間あたりの送信回数の上限に達しました。いちばん古い送信から24時間が過ぎると、また送れるようになります。",
  broadcastLimitTotalError:
    "このイベントで送れる回数を使い切りました。時間をおいても増えません。どうしても必要な場合は運営にお問い合わせください。",
  broadcastSendFailed: "送信できませんでした。時間をおいて試してください。",
  broadcastRetryFailed: "送り直せませんでした。時間をおいて試してください。",
  /** 送信履歴 */
  broadcastHistoryTitle: "送信履歴",
  broadcastHistoryNote: "この一覧はスタッフだけが見られます。",
  broadcastHistoryEmpty: "まだ送信していません。",
  broadcastIncompleteChip: "一部のみ送信",
  broadcastSentToOne: "{{n}} 人へ",
  broadcastSentTo: "{{n}} 人へ",
  broadcastIncompleteNotice:
    "途中で失敗したため、この人数までにしかお知らせが届いていません。同じ内容をもう一度送ると、すでに届いている人には2通届きます。",
  /** メールの送信状況 */
  broadcastEmailNone: "メールの宛先はありません（アプリ内のお知らせのみ）",
  broadcastEmailPending: "送信待ち {{n}}",
  broadcastEmailSent: "送信済み {{n}}",
  broadcastEmailFailed: "失敗 {{n}}",
  broadcastEmailSkipped: "対象外 {{n}}",
  broadcastRetryOne: "失敗した {{n}} 件を送り直す",
  broadcastRetry: "失敗した {{n}} 件を送り直す",
  broadcastRetryNote:
    "送り直しても、すでに届いた人にもう1通増えることはありません。送信回数も消費しません。",
  /** 送信前の確認 */
  broadcastConfirmTitle: "この内容で送信します",
  broadcastConfirmWarning:
    "送信後は取り消せません。送る相手と人数を確かめてください。",
  broadcastConfirmEmpty:
    "いまこの区分に当てはまる人はいません。送信しても誰にも届きません。",
  broadcastConfirmCancel: "やめる",
  broadcastSendOne: "{{n}} 人に送信する",
  broadcastSend: "{{n}} 人に送信する",
  /** 送信できたときの報告。画面側が順につないで1文にする */
  broadcastSentOne: "{{n}} 人にお知らせを送りました。",
  broadcastSent: "{{n}} 人にお知らせを送りました。",
  broadcastSentEmailOne:
    "そのうちメールを受け取る設定の {{n}} 人には、順にメールも届きます（送りきるまで{{eta}}ほどかかります）。",
  broadcastSentEmail:
    "そのうちメールを受け取る設定の {{n}} 人には、順にメールも届きます（送りきるまで{{eta}}ほどかかります）。",
  broadcastSentNoEmail: "メールの宛先はありませんでした。",
  broadcastTruncated:
    "なお、区分に当てはまる {{total}} 人のうち {{n}} 人までで打ち切りました。残りの人には届いていません。",
  broadcastPartial:
    "途中で失敗したため、{{n}} 人までにしかお知らせが届いていません。同じ内容をもう一度送ると、すでに届いている人には2通届きます。下の送信履歴で届いた人数を確かめてから、必要な場合だけ送り直してください。",
  /** 区分どうしが重なることの注意。日本語はもとの定数が source */
  segmentOverlapNote: BROADCAST_OVERLAP_NOTE,
  /** メールを送りきるまでの見積もり。単位は略記にしてあるので単数・複数を分けない
   *  （common.remainingHours と同じ書き方） */
  etaMinutes: "約{{n}}分",
  etaHours: "約{{n}}時間",
  etaHoursMinutes: "約{{h}}時間{{m}}分",
} as const;

const en: Record<keyof typeof ja, string> = {
  broadcastStaffOnly: "Announcements are for organizers only.",
  broadcastIntro:
    "Choose who to reach and send them an announcement. In-app notifications arrive right away. Emails go out in batches at roughly {{perHour}} per hour, so a full run takes {{eta100}} for 100 people and {{eta300}} for 300. When other events have announcements queued at the same time, the queue is shared and it can take longer. For anything urgent, the in-app notification gets there first.",
  broadcastSegmentField: "Recipients",
  broadcastSegmentOption: "{{label}} ({{n}})",
  broadcastCountNote:
    "The number shown is how many people will actually receive it. You can read what you sent in the history on this page, so it is not sent to you.",
  broadcastTitleHelp: "This becomes the headline of the announcement.",
  broadcastBodyField: "Message",
  broadcastBodyHelp: "You cannot take this back once it is sent.",
  broadcastNoUndoWarning:
    "You cannot take this back once it is sent. Notifications and emails that have arrived cannot be deleted.",
  broadcastConfirmOpen: "Review before sending",
  broadcastRemaining:
    "{{today}} more today / {{total}} more in total for this event",
  broadcastLimitTotalNotice:
    "You have used up every announcement for this event. Waiting does not give you more.",
  broadcastLimitDayNotice:
    "You have reached the limit for the last 24 hours. You can send again once 24 hours have passed since your oldest announcement.",
  broadcastLimitTotalError:
    "You have used up every announcement for this event. Waiting does not give you more. If you really need another one, please contact support.",
  broadcastSendFailed: "Could not send this. Please try again later.",
  broadcastRetryFailed: "Could not resend these. Please try again later.",
  broadcastHistoryTitle: "Sent announcements",
  broadcastHistoryNote: "Only organizers can see this list.",
  broadcastHistoryEmpty: "You have not sent anything yet.",
  broadcastIncompleteChip: "Partly sent",
  broadcastSentToOne: "to {{n}} person",
  broadcastSentTo: "to {{n}} people",
  broadcastIncompleteNotice:
    "Sending failed part way through, so only this many people received it. If you send the same thing again, everyone who already got it will receive a second copy.",
  broadcastEmailNone: "No email recipients (in-app notifications only)",
  broadcastEmailPending: "Queued {{n}}",
  broadcastEmailSent: "Sent {{n}}",
  broadcastEmailFailed: "Failed {{n}}",
  broadcastEmailSkipped: "Skipped {{n}}",
  broadcastRetryOne: "Resend {{n}} failed email",
  broadcastRetry: "Resend {{n}} failed emails",
  broadcastRetryNote:
    "Resending never gives a second copy to anyone who already received it, and it does not use up another announcement.",
  broadcastConfirmTitle: "Send this announcement",
  broadcastConfirmWarning:
    "You cannot take this back once it is sent. Check who it goes to and how many people that is.",
  broadcastConfirmEmpty:
    "Nobody matches this group right now, so sending it would reach no one.",
  broadcastConfirmCancel: "Cancel",
  broadcastSendOne: "Send to {{n}} person",
  broadcastSend: "Send to {{n}} people",
  broadcastSentOne: "The announcement was sent to {{n}} person.",
  broadcastSent: "The announcement was sent to {{n}} people.",
  broadcastSentEmailOne:
    "{{n}} of them has email turned on and will get it by email as well (about {{eta}} to send them all).",
  broadcastSentEmail:
    "{{n}} of them have email turned on and will get it by email as well (about {{eta}} to send them all).",
  broadcastSentNoEmail: "There were no email recipients.",
  broadcastTruncated:
    "Note that {{total}} people matched this group, but sending stopped after {{n}}. The rest did not receive it.",
  broadcastPartial:
    "Sending failed part way through, so only {{n}} people received the announcement. If you send the same thing again, everyone who already got it will receive a second copy. Check how many people it reached in the history below, and only resend if you need to.",
  segmentOverlapNote:
    "The groups overlap: people selected in the lottery are also in “Confirmed”, and organizers, judges and viewers are also in “Checked in”. If you send to two groups one after the other, anyone in both receives two copies.",
  etaMinutes: "about {{n}} min",
  etaHours: "about {{n}} h",
  etaHoursMinutes: "about {{h}} h {{m}} min",
};

export const broadcast = { ja, en };

/** 一斉連絡の送信先区分。日本語はもとの定数が source */
const segmentEn: Record<BroadcastSegment, string> = {
  all: "Everyone",
  confirmed: "Confirmed",
  waitlist: "Waiting list",
  lottery_won: "Selected in the lottery",
  lost: "Not selected",
  staff: "Organizers",
  judge: "Judges",
  observer: "Viewers",
  attended: "Checked in",
  not_attended: "Did not check in",
};

/** 区分が誰を指すかの補足。日本語はもとの定数が source */
const segmentNoteEn: Record<BroadcastSegment, string> = {
  all: "Everyone involved in this event except people who cancelled or were not selected. That includes organizers, judges and viewers, as well as anyone on the waiting list or waiting for the lottery.",
  confirmed:
    "Participants whose registration is confirmed, including everyone selected in the lottery. Organizers, judges and viewers are not included.",
  waitlist:
    "Participants on the waiting list because the first-come slot was full.",
  lottery_won:
    "Participants selected in a lottery slot. They are also part of “Confirmed”, so sending to both means two copies.",
  lost: "Participants who were not selected and are still not taking part. This also covers lottery slots you removed later, and people you marked as not selected on a first-come slot. They are not part of “Everyone”.",
  staff: "Organizers of this event (except those who stepped down).",
  judge: "Judges for this event (except those who stepped down).",
  observer: "Viewers of this event (except those who cancelled).",
  attended:
    "People checked in at the desk. Not only participants — organizers, judges and viewers who came through check-in are included too.",
  not_attended:
    "Participants who were confirmed but have no check-in record. At events that do not use check-in, every confirmed participant lands here.",
};

export const broadcastSegment = {
  ja: BROADCAST_SEGMENT_LABELS,
  en: segmentEn,
};
export const broadcastSegmentNote = {
  ja: BROADCAST_SEGMENT_NOTES,
  en: segmentNoteEn,
};
