/** イベント詳細の文言 (#352) */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
const ja = {
  join: "参加する",
  cancel: "参加をやめる",
  deadline: "申込締切",
  participantsHeading: "参加者",
  description: "説明",
  organizer: "主催",

  /** 開けなかったとき */
  notFound: "このイベントは見つからないか、非公開です。",

  /** 見出しまわり */
  fromRequest: "「{{title}}」のたまごから生まれました",
  schedulingTbd: "日程調整中（開催日時は未定）",
  /** 募集締切 (#269)。日時は Intl が組み立てたものを差し込む */
  deadlineAt: "募集締切: {{date}}",
  deadlineClosedSuffix: "（締め切りました）",
  deadlineRemainingSuffix: "（{{remaining}}）",

  /** 下書きの注意。<b> は太字（画面側が <strong> に差し替える） */
  draftNotice:
    "このイベントは<b>下書き</b>です。公開するまで他の人には表示されず、シェアリンクも開けません。",
  publish: "公開する",

  /** 表彰 */
  awardsHeading: "表彰結果",
  noRecipient: "該当者なし",
  viewResults: "採点結果を見る",

  /** 説明カードの会場欄 */
  venueOffline: "会場: {{venue}}",
  venueOnline: "オンライン:",

  /** 参加者限定のお知らせ */
  membersNoteHeading: "参加者限定のお知らせ",
  membersNoteCaption: "この内容は参加確定した人とスタッフにだけ表示されています。",

  /** 参加まわりの操作 */
  myStatus: "参加状態: {{status}}",
  entranceQr: "入場QR",
  editSurveyAnswers: "アンケート回答を編集",
  endedChip: "このイベントは終了しました",
  closedChip: "募集は締め切りました",
  loginToJoin: "ログインして参加",
  leave: "参加を解除する",
  register: "参加登録する",
  /** 締切・終了をまたいだページから押したときの理由 (#269) */
  joinClosedError: "募集は締め切りました。",
  joinEndedError: "このイベントは終了しました。",
  surveySubmitJoin: "回答して参加する",
  surveySubmitSave: "回答を保存",

  /** 採点・進行 */
  scoringOpen: "採点を受付中です。各チームを採点できます（あとから何度でも変更可）。",
  scoreNow: "採点する",
  modeRunning: "進行中: {{mode}}",
  modePresentation: "プレゼン",
  modeAggregation: "集計",
  modeAwards: "表彰",
  toPresentation: "プレゼン画面へ",
  toAwards: "表彰式へ",

  /** 参加者・スタッフ向けの入口ボタン */
  scoring: "採点",
  live: "配信",
  broadcast: "一斉連絡",
  stats: "アクセス統計",
  checkin: "QR受付",
  nameCards: "名札の印刷",
  control: "進行コントロール",
  criteria: "採点項目",
  awards: "表彰式",

  /** 成果物 */
  mySubmission: "あなたの成果物",
  presentationUrl: "プレゼン資料 URL",
  sourceCodeUrl: "ソースコード URL",
  submissionSaveFailed: "保存に失敗しました（URL 形式を確認）",
  submissionSaved: "保存しました",
  submissionsHeading: "成果物一覧",
  submissionSlides: "資料",
  submissionCode: "コード",

  /** 参加者一覧 */
  participantsWithCount: "参加者一覧（{{n}}）",
  attendanceModeNotice:
    "出席チェックモード：チェックされた人だけが参加者として記録されます。",
  attendanceModeNoticeStaff:
    "出席チェックモード：チェックされた人だけが参加者として記録されます。名前の右で出欠を切り替えられます。",
  statusConfirmed: "確定",
  statusWaitlist: "キャンセル待ち",
  statusApplied: "抽選申込中",
  statusLost: "落選",
  attendedChip: "出席",
  attendCheck: "出席チェック",
  attendUncheckOnly:
    "参加が確定していないため（現在: {{status}}）、出席の解除だけできます。",
  attendNotConfirmed:
    "参加が確定していないため出席にできません（現在: {{status}}）。参加枠の「申込者の管理」で先に参加を確定にしてください。",
  changeRole: "ロールを変更",
  demoteConfirm:
    "{{name}} さんを一般参加者に戻すと、参加枠と申込を取り消します。参加者一覧から外れ、事前アンケートの回答も削除されます（元に戻せません）。参加するには本人が改めて申し込む必要があります。よろしいですか？",

  /** ロール変更が断られた理由 (#281)。共通の辞書より一歩踏み込んで、
   * 次に何をすればよいかまで書く。ここに無いコードは共通の辞書に落ちる */
  roleErrorDefault: "ロールを変更できませんでした。時間をおいて試してください。",
  roleErrorLastStaff:
    "このイベントの最後のスタッフです。先に別の人をスタッフにしてください。",
  roleErrorEventEnded:
    "終了したイベントでは一般参加者に戻せません（参加履歴が残るため）。",
  roleErrorNotFound: "対象が見つかりませんでした。画面を更新してください。",

  /** 出席チェックが断られた理由 (#286) */
  attendanceErrorDefault: "出席を変更できませんでした。時間をおいて試してください。",
  attendanceErrorNotConfirmed:
    "参加が確定している人だけ出席にできます。参加枠の「申込者の管理」で先に参加を確定にしてください。",
  attendanceErrorNotFound: "対象が見つかりませんでした。画面を更新してください。",
} as const;

const en: Record<keyof typeof ja, string> = {
  join: "Join",
  cancel: "Cancel registration",
  deadline: "Registration deadline",
  participantsHeading: "Participants",
  description: "About",
  organizer: "Host",

  notFound: "This event does not exist, or it is not public.",

  fromRequest: "Hatched from the idea “{{title}}”",
  schedulingTbd: "Picking a date (start time not set yet)",
  // 日時のあとに続けて差し込むので、英語では区切りの空白を先頭に入れる
  deadlineAt: "Registration closes: {{date}}",
  deadlineClosedSuffix: " (closed)",
  deadlineRemainingSuffix: " ({{remaining}})",

  draftNotice:
    "This event is a <b>draft</b>. Until you publish it, nobody else can see it and share links will not open.",
  publish: "Publish",

  awardsHeading: "Awards",
  noRecipient: "Not awarded",
  viewResults: "See the scores",

  venueOffline: "Venue: {{venue}}",
  venueOnline: "Online:",

  membersNoteHeading: "Note for participants",
  membersNoteCaption:
    "Only confirmed participants and organizers can see this.",

  myStatus: "Your status: {{status}}",
  entranceQr: "Entry QR",
  editSurveyAnswers: "Edit survey answers",
  endedChip: "This event has ended",
  closedChip: "Registration is closed",
  loginToJoin: "Sign in to join",
  leave: "Leave this event",
  register: "Join this event",
  joinClosedError: "Registration is closed.",
  joinEndedError: "This event has ended.",
  surveySubmitJoin: "Submit and join",
  surveySubmitSave: "Save answers",

  scoringOpen:
    "Scoring is open. You can score every team, and change your scores as often as you like.",
  scoreNow: "Score the teams",
  modeRunning: "In progress: {{mode}}",
  modePresentation: "Presentations",
  modeAggregation: "Tallying",
  modeAwards: "Awards",
  toPresentation: "Go to the presentation view",
  toAwards: "Go to the awards ceremony",

  scoring: "Scoring",
  live: "Broadcast",
  broadcast: "Announcement",
  stats: "Traffic",
  checkin: "QR check-in",
  nameCards: "Print name cards",
  control: "Run the event",
  criteria: "Scoring criteria",
  awards: "Awards ceremony",

  mySubmission: "Your submission",
  presentationUrl: "Slides URL",
  sourceCodeUrl: "Source code URL",
  submissionSaveFailed: "Could not save. Check that the URLs are valid.",
  submissionSaved: "Saved",
  submissionsHeading: "Submissions",
  submissionSlides: "Slides",
  submissionCode: "Code",

  participantsWithCount: "Participants ({{n}})",
  attendanceModeNotice:
    "Attendance check is on: only people who are checked in count as participants.",
  attendanceModeNoticeStaff:
    "Attendance check is on: only people who are checked in count as participants. Use the checkbox next to each name.",
  statusConfirmed: "Confirmed",
  statusWaitlist: "Waitlisted",
  statusApplied: "In the lottery",
  statusLost: "Not selected",
  attendedChip: "Attended",
  attendCheck: "Mark as attended",
  attendUncheckOnly:
    "This person is not confirmed ({{status}}), so you can only clear their attendance.",
  attendNotConfirmed:
    "This person is not confirmed ({{status}}), so they cannot be marked as attended. Confirm them first from the applicant list of the slot.",
  changeRole: "Change role",
  demoteConfirm:
    "Moving {{name}} back to participant cancels their slot and their registration. They will drop off the participant list and their survey answers will be deleted, and none of that can be undone — they would have to sign up again. Continue?",

  roleErrorDefault: "Could not change the role. Please try again later.",
  roleErrorLastStaff:
    "This is the last organizer for this event. Make someone else an organizer first.",
  roleErrorEventEnded:
    "You cannot move someone back to participant after the event has ended, because the attendance record stays.",
  roleErrorNotFound: "That was not found. Please reload the page.",

  attendanceErrorDefault: "Could not change attendance. Please try again later.",
  attendanceErrorNotConfirmed:
    "Only confirmed participants can be marked as attended. Confirm them first from the applicant list.",
  attendanceErrorNotFound: "That was not found. Please reload the page.",
};

export const eventDetail = { ja, en };
