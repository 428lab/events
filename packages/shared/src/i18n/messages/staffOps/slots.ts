/** 申込者の管理 (#286)。参加確定・キャンセル待ち・落選の切り替え。 */
const ja = {
  /* ── 申込者の管理 (#286) ───────────────────────────────── */
  slotAdminStaffOnly: "申込者の管理はスタッフ専用です。",
  slotAdminTitle: "申込者の管理",
  slotAdminIntro:
    "参加枠ごとの申込者です。参加確定・キャンセル待ち・落選をここで切り替えられます。当日キャンセルが出たときにキャンセル待ちの人を確定にするのもこの画面です。",
  slotNone: "参加枠がありません。",
  slotOverCapacity: "定員超過",
  /** 枠の要約。区切りは common.dotSeparator で画面側がつなぐ */
  slotConfirmedOfCapacity: "確定 {{n}} / 定員 {{capacity}}",
  slotWonOfCapacity: "当選 {{n}} / 定員 {{capacity}}",
  slotApplicantCount: "申込 {{n}} 人",
  slotApplicantsCount: "申込 {{n}} 人",
  slotWaitlistCount: "キャンセル待ち {{n}} 人",
  slotDrawAt: "抽選日時 {{date}}",
  slotDraw: "自動抽選（申込中 {{applied}} → 定員 {{capacity}}）",
  slotNoApplicants: "まだ申込者がいません。",
  /** 同じ confirmed でも、抽選枠なら「当選」、先着枠なら「参加確定」と読むほうが
   *  自然なので枠の方式で言い分ける。「キャンセル待ち」「落選」は
   *  eventDetail.statusWaitlist / statusLost と同じ文言なのでここには持たない */
  statusWon: "当選",
  statusFirstComeConfirmed: "参加確定",
  statusApplying: "申込中",
  slotOverCapacityConfirm:
    "{{slot}}は定員 {{capacity}} 人に対して既に {{confirmed}} 人が確定しています。{{name}} さんを確定にすると定員を超えます。よろしいですか？",
  slotStatusChangeFailed:
    "{{name}} さんの参加状態を変更できませんでした。画面を開いたまま状態が変わった可能性があります",
} as const;

const en: Record<keyof typeof ja, string> = {
  slotAdminStaffOnly: "Managing applicants is for organizers only.",
  slotAdminTitle: "Applicants",
  slotAdminIntro:
    "These are the applicants for each participation slot. You can confirm people, move them to the waiting list, or mark them as not selected. This is also where you promote someone from the waiting list when a seat opens up on the day.",
  slotNone: "This event has no participation slots.",
  slotOverCapacity: "Over capacity",
  slotConfirmedOfCapacity: "Confirmed {{n}} / {{capacity}}",
  slotWonOfCapacity: "Selected {{n}} / {{capacity}}",
  slotApplicantCount: "{{n}} applicant",
  slotApplicantsCount: "{{n}} applicants",
  slotWaitlistCount: "{{n}} waitlisted",
  slotDrawAt: "Draw at {{date}}",
  slotDraw: "Run the lottery ({{applied}} applied → {{capacity}} seats)",
  slotNoApplicants: "No applicants yet.",
  statusWon: "Selected",
  statusFirstComeConfirmed: "Confirmed",
  statusApplying: "Applied",
  slotOverCapacityConfirm:
    "{{slot}} has {{capacity}} seats and {{confirmed}} people are already confirmed. Confirming {{name}} will go over capacity. Continue?",
  slotStatusChangeFailed:
    "Could not change the status for {{name}}. It may have changed while this page was open.",
};

export const slots = { ja, en };
