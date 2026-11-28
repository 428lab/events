/**
 * サーバーが作る文言 (#352): アプリ内のお知らせ・メール・メールから開くページ・staging のサインイン。
 *
 * **受け取る人の言語で作る**（オーナー決定 2026-11-19、案 A）。言語は user.language
 * （本人が最後に使った画面の言語。設定で選んだ言語があればそちらが優先。migration 0128）。
 * 分からない人は日本語。組み立てはサーバーの `lib/noticeText.ts` の1か所。
 *
 * **日本語はこれまでサーバーに直書きしていた文言と1文字も変えていない**（既存のお知らせ・
 * メールの見た目と、それを見るテストを変えないため）。イベント名・会場名など人が入力したものは
 * `{{event}}` などの差し込みで、訳さない。
 *
 * 管理者だけに届くお知らせ（要確認の検知・新しいお問い合わせ）は、管理画面と同じく
 * 対象外のまま日本語（#352 の線引き）。Discord / Slack の Webhook もチャンネル宛てなので日本語。
 */
const ja = {
  /* ── 中身を出せないイベント（非公開など）の中立の文言 ───────────── */
  genericTitle: "イベントの更新があります",
  /** 本文がイベント名などを「」でくくるだけのとき */
  quoted: "「{{text}}」",

  /* ── 参加・抽選・繰り上がり・日程 ─────────────────────────── */
  registrationConfirmedTitle: "参加が確定しました",
  registrationConfirmedBody: "「{{event}}」への参加が確定しました",
  waitlistPromotedTitle: "キャンセル待ちから繰り上がりました",
  lotteryWonTitle: "抽選に当選しました",
  lotteryResultTitle: "抽選結果のお知らせ",
  lotteryWonBody: "「{{event}}」の抽選に当選しました。参加が確定です",
  lotteryLostBody: "「{{event}}」は今回は落選となりました",
  staffCancelTitle: "運営があなたの参加をキャンセル扱いにしました",
  schedulingReopenedTitle: "日程調整を再開しました",
  schedulingReopenedBody:
    "「{{event}}」の日程が未定になりました。候補日への回答をご確認ください。参加登録は維持されています。",
  scheduleFinalizedTitle: "日程が確定しました",
  scheduleFinalizedBody: "「{{event}}」の開催日時が {{date}} に決定しました",
  /** 日程の確定の本文の後ろにつなぐ一文。先頭の句点も含む */
  scheduleRegisteredConfirmed:
    "。○・△の回答に基づいて参加登録しました。変更する場合はイベントページから参加を取り消せます。",
  scheduleRegisteredWaitlist: "。満員のためキャンセル待ちとして登録しました。",
  scheduleRegisteredLottery: "。抽選申込として登録しました。参加確定ではありません。",
  scheduleKeptCanceled: "。以前の参加取消を維持しました。参加する場合は再登録してください。",
  scheduleNeedsSurvey: "。参加登録には必須アンケートへの回答が必要です。",
  scheduleNeedsSlot: "。参加登録には参加枠の選択が必要です。",
  scheduleEventEnded: "。終了済みのため参加登録していません。必要な場合は主催者に確認してください。",
  scheduleRegistrationClosed:
    "。募集締切後のため参加登録していません。必要な場合は主催者に確認してください。",
  scheduleKeptRegistration:
    "。参加登録は維持されています。参加できない場合はイベントページから参加を取り消してください。",
  surveyReminderTitle: "アンケート回答のお願い",
  surveyReminderBody: "「{{event}}」の参加アンケートにご回答ください",
  accessInviteTitle: "閲覧への招待が届きました",

  /* ── 出会い ─────────────────────────────────────── */
  meetTitleNamed: "{{name}} さんと出会いました",
  meetTitle: "出会いを記録しました",
  meetBodyPrivate: "イベントページで最新の情報をご確認ください",
  meetBodyCheckedIn: "「{{event}}」の受付もこれで完了しています",

  /* ── 運営・共催・表彰・問い合わせ ─────────────────────────── */
  staffInviteTitle: "「{{event}}」の運営に招待されました",
  staffInviteBody: "{{name}} さんからの招待です。承諾すると運営として準備に参加できます。",
  staffInviteAcceptedTitle: "「{{event}}」の運営への招待が承諾されました",
  staffInviteDeclinedTitle: "「{{event}}」の運営への招待が辞退されました",
  staffInviteAcceptedBody: "{{name}} さんが運営に加わりました",
  staffInviteDeclinedBody: "{{name}} さんは運営に加わりませんでした",
  cohostRequestTitle: "「{{event}}」の共催の依頼が届きました",
  cohostRequestBody: "{{from}} から {{community}} への共催の依頼です。",
  cohostAcceptedTitle: "「{{event}}」の共催が承諾されました",
  cohostDeclinedTitle: "「{{event}}」の共催が辞退されました",
  cohostAcceptedBody: "{{community}} が共催に加わりました。",
  cohostDeclinedBody: "{{community}} は共催に加わりませんでした。",
  awardTitle: "受賞おめでとうございます🎉",
  awardBody: "「{{event}}」で{{award}}を受賞しました",
  eventInquiryNewTitle: "「{{event}}」に問い合わせが届きました",
  eventInquiryReplyTitle: "主催者から返信がありました",
  inquiryReplyTitle: "お問い合わせに返信がありました",
  /** 運営からメンバーへの個別の連絡（運営から始める問い合わせ） */
  staffContactTitle: "「{{event}}」の運営から連絡が届きました",
  /** 新規登録した人の連携を最初からプロフィールに出したことを伝える（オーナー決定 2026-11-27） */
  profileLinkDefaultOnTitle: "プロフィールに連携アカウントを表示しています",
  profileLinkDefaultOnBody: "公開プロフィールに {{link}} へのリンクを表示しています。表示しない場合は、アカウント設定の「ログイン方法（連携）」で変えられます。",
  /** 運営からの連絡に、相手が返信した（送ったスタッフ・運営へ） */
  staffContactReplyTitle: "「{{event}}」の運営からの連絡に返信がありました",

  /* ── フォロー・たまご ──────────────────────────────── */
  /** 先頭の「フォロー中の 」はメールで名前をリンクにするとき目印に使う（emailTemplates の FOLLOWING_TITLE_PREFIX） */
  followeePublishedNamed: "フォロー中の {{name}} さんがイベントを公開しました",
  followeeJoinedNamed: "フォロー中の {{name}} さんがイベントに参加しました",
  followeePublished: "フォロー中のユーザーがイベントを公開しました",
  followeeJoined: "フォロー中のユーザーがイベントに参加しました",
  eggHatchedTitle: "たまごからイベントが生まれました🐣",
  eggHatchedBody: "「{{egg}}」に応えるイベント「{{event}}」が作られました",

  /* ── 会場 ─────────────────────────────────────── */
  venueAdminTitle: "会場の管理者になりました🏟️",
  venueAdminBody: "「{{venue}}」の管理者に追加されました",
  venueOwnerTitle: "会場のオーナーになりました🏟️",
  venueOwnerBody: "「{{venue}}」のオーナー権限が移譲されました",
  venuePhotoSubmittedTitle: "会場写真の投稿が届きました📷",
  venuePhotoSubmittedBody: "「{{venue}}」に参加者から写真が投稿されました（承認待ち）",
  venuePhotoApprovedTitle: "会場写真が採用されました🎉",
  venuePhotoApprovedBody: "「{{venue}}」であなたの写真が公開されました",
  venuePhotoRejectedTitle: "会場写真は見送られました",
  venuePhotoRejectedBody: "「{{venue}}」への投稿写真は公開されませんでした",
  venueOfferTitle: "会場の提供オファーが届きました🏟️",
  venueOfferBody: "「{{target}}」に会場「{{venue}}」の提供オファー",
  venueRequestTitle: "会場の利用オファーが届きました🏟️",
  venueRequestBody: "「{{target}}」の主催者が会場「{{venue}}」を使いたいそうです",
  venueOfferAcceptedTitle: "会場オファーが承諾されました🎉",
  venueOfferDeclinedTitle: "会場オファーは見送られました",
  venueOfferResultBody: "会場「{{venue}}」のオファー",

  /* ── メール（通知メール・前日リマインダー） ─────────────────── */
  emailViewDetails: "詳細を見る",
  emailFooterReason: "このメールは events lab のメール通知設定が ON のため送信されています。",
  emailUnsubscribe: "メール通知を停止する",
  emailCardDate: "開催日時",
  emailCardVenue: "会場",
  emailCardCommunity: "コミュニティ",
  emailTimetable: "タイムテーブル",
  emailSpeaker: "（{{name}}）",
  dateScheduling: "日程調整中",
  dateUndecided: "日時未定",
  venueWithPlace: "{{label}}（{{place}}）",
  reminderTomorrow: "明日開催",
  reminderToday: "本日開催",
  reminderSubject: "{{prefix}}:「{{event}}」",
  reminderBody: "{{start}} 開始 ／ {{venue}}",

  /* ── メールから開く配信停止のページ ─────────────────────── */
  unsubscribePageTitle: "メール通知の停止",
  unsubscribeConfirmTitle: "メール通知を停止しますか？",
  unsubscribeConfirmLead: "events lab からの通知メールが届かなくなります。",
  unsubscribeDoneTitle: "メール通知を停止しました",
  unsubscribeDoneLead:
    "再開するには events lab のアカウント設定から「メール通知」を ON にしてください。",

  /* ── staging のサインイン（ブラウザの言語で出す） ─────────────── */
  gateSignInWith: "{{provider}} でサインイン",
  gateNostrMissing: "NIP-07 拡張が見つかりません",
  gateSignInFailed: "サインインに失敗しました",
} as const;

const en: Record<keyof typeof ja, string> = {
  genericTitle: "There is an update to an event",
  quoted: "\"{{text}}\"",

  registrationConfirmedTitle: "Your place is confirmed",
  registrationConfirmedBody: "Your place at \"{{event}}\" is confirmed",
  waitlistPromotedTitle: "You moved up from the waitlist",
  lotteryWonTitle: "You won the lottery",
  lotteryResultTitle: "Lottery result",
  lotteryWonBody: "You won the lottery for \"{{event}}\". Your place is confirmed",
  lotteryLostBody: "You were not selected for \"{{event}}\" this time",
  staffCancelTitle: "The organizers marked your registration as cancelled",
  schedulingReopenedTitle: "Scheduling has been reopened",
  schedulingReopenedBody:
    "The date of \"{{event}}\" is undecided again. Please check your answers to the date options. Your registration is kept.",
  scheduleFinalizedTitle: "The date has been decided",
  scheduleFinalizedBody: "\"{{event}}\" will be held on {{date}}",
  scheduleRegisteredConfirmed:
    ". Based on your Yes or Maybe answer, you are now registered. To change this, cancel from the event page.",
  scheduleRegisteredWaitlist: ". The event is full, so you are on the waitlist.",
  scheduleRegisteredLottery: ". You have entered the lottery. Your place is not confirmed yet.",
  scheduleKeptCanceled: ". Your earlier cancellation still stands. Register again if you want to join.",
  scheduleNeedsSurvey: ". To register, please answer the required survey.",
  scheduleNeedsSlot: ". To register, please choose a participation slot.",
  scheduleEventEnded:
    ". The event has ended, so you were not registered. Contact the organizer if needed.",
  scheduleRegistrationClosed:
    ". Registration had closed, so you were not registered. Contact the organizer if needed.",
  scheduleKeptRegistration:
    ". Your registration is kept. If you can't attend, cancel from the event page.",
  surveyReminderTitle: "Please answer the survey",
  surveyReminderBody: "Please answer the participant survey for \"{{event}}\"",
  accessInviteTitle: "You have been invited to view an event",

  meetTitleNamed: "You met {{name}}",
  meetTitle: "A meeting was recorded",
  meetBodyPrivate: "Check the event page for the latest information",
  meetBodyCheckedIn: "This also completed your check-in for \"{{event}}\"",

  staffInviteTitle: "You have been invited to organize \"{{event}}\"",
  staffInviteBody: "Invited by {{name}}. Accept to join the organizers and help prepare.",
  staffInviteAcceptedTitle: "Your organizer invite for \"{{event}}\" was accepted",
  staffInviteDeclinedTitle: "Your organizer invite for \"{{event}}\" was declined",
  staffInviteAcceptedBody: "{{name}} joined the organizers",
  staffInviteDeclinedBody: "{{name}} did not join the organizers",
  cohostRequestTitle: "Co-host request for \"{{event}}\"",
  cohostRequestBody: "{{from}} asked {{community}} to co-host.",
  cohostAcceptedTitle: "The co-host request for \"{{event}}\" was accepted",
  cohostDeclinedTitle: "The co-host request for \"{{event}}\" was declined",
  cohostAcceptedBody: "{{community}} joined as a co-host.",
  cohostDeclinedBody: "{{community}} did not join as a co-host.",
  awardTitle: "Congratulations on your award 🎉",
  awardBody: "You received {{award}} at \"{{event}}\"",
  eventInquiryNewTitle: "New inquiry about \"{{event}}\"",
  eventInquiryReplyTitle: "The organizer replied",
  inquiryReplyTitle: "You have a reply to your inquiry",
  staffContactTitle: "A message from the organizers of \"{{event}}\"",
  profileLinkDefaultOnTitle: "Your linked account is shown on your profile",
  profileLinkDefaultOnBody: "Your public profile shows a link to {{link}}. To hide it, change it under \"Login methods\" in your account settings.",
  staffContactReplyTitle: "Reply to the organizers' message about \"{{event}}\"",

  // 名前で始める。メールで名前をリンクにする処理（actorTitleHtml）が先頭の名前を目印にする
  followeePublishedNamed: "{{name}}, whom you follow, published an event",
  followeeJoinedNamed: "{{name}}, whom you follow, joined an event",
  followeePublished: "Someone you follow published an event",
  followeeJoined: "Someone you follow joined an event",
  eggHatchedTitle: "An event hatched from an egg 🐣",
  eggHatchedBody: "The event \"{{event}}\" was created in response to \"{{egg}}\"",

  venueAdminTitle: "You are now a venue manager 🏟️",
  venueAdminBody: "You were added as a manager of \"{{venue}}\"",
  venueOwnerTitle: "You are now a venue owner 🏟️",
  venueOwnerBody: "Ownership of \"{{venue}}\" was transferred to you",
  venuePhotoSubmittedTitle: "A venue photo was submitted 📷",
  venuePhotoSubmittedBody: "A participant submitted a photo for \"{{venue}}\" (awaiting approval)",
  venuePhotoApprovedTitle: "Your venue photo was accepted 🎉",
  venuePhotoApprovedBody: "Your photo is now public on \"{{venue}}\"",
  venuePhotoRejectedTitle: "Your venue photo was not accepted",
  venuePhotoRejectedBody: "Your photo for \"{{venue}}\" was not published",
  venueOfferTitle: "You received a venue offer 🏟️",
  venueOfferBody: "An offer of the venue \"{{venue}}\" for \"{{target}}\"",
  venueRequestTitle: "You received a request to use your venue 🏟️",
  venueRequestBody: "The organizer of \"{{target}}\" would like to use the venue \"{{venue}}\"",
  venueOfferAcceptedTitle: "Your venue offer was accepted 🎉",
  venueOfferDeclinedTitle: "Your venue offer was declined",
  venueOfferResultBody: "Offer for the venue \"{{venue}}\"",

  emailViewDetails: "View details",
  emailFooterReason:
    "You are receiving this email because email notifications are on in your events lab settings.",
  emailUnsubscribe: "Turn off email notifications",
  emailCardDate: "Date and time",
  emailCardVenue: "Venue",
  emailCardCommunity: "Community",
  emailTimetable: "Timetable",
  emailSpeaker: "({{name}})",
  dateScheduling: "Date being scheduled",
  dateUndecided: "Date not set",
  venueWithPlace: "{{label}} ({{place}})",
  reminderTomorrow: "Tomorrow",
  reminderToday: "Today",
  reminderSubject: "{{prefix}}: \"{{event}}\"",
  reminderBody: "Starts {{start}} / {{venue}}",

  unsubscribePageTitle: "Turn off email notifications",
  unsubscribeConfirmTitle: "Turn off email notifications?",
  unsubscribeConfirmLead: "You will no longer receive notification emails from events lab.",
  unsubscribeDoneTitle: "Email notifications are turned off",
  unsubscribeDoneLead:
    "To turn them back on, enable \"Email notifications\" in your events lab account settings.",

  gateSignInWith: "Sign in with {{provider}}",
  gateNostrMissing: "No NIP-07 extension was found",
  gateSignInFailed: "Sign-in failed",
};

export const notices = { ja, en };
