/** イベント詳細の文言 (#352) */
const ja = {
  join: "参加する",
  cancel: "参加をやめる",
  deadline: "申込締切",
  participantsHeading: "参加者",
  description: "説明",
  organizer: "主催",

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
