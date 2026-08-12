/**
 * 当日のスケジュール（タイムテーブル）の文言 (#363)。
 *
 * 編集する側（スケジュール編集・トラック管理）と、読む側（タイムテーブル表示）で
 * 同じ言い方を使うので1つの名前空間にまとめてある。
 *
 * **開催日を決める投票（日程調整）** も同じ画面群の続きなので、ここに入れている。
 *
 * 日時そのものの書式は `lib/format.ts`（Intl）が組み立てる。ここが持つのは
 * 「言語で並べ方・記号が変わる型」と、アプリが用意した固定の文言だけ。
 * **利用者が入力したトラック名やコマの題名は訳さない**（そのまま出す）。
 */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
const ja = {
  /** 日程調整（候補日への○△×投票）の見出しと導入 */
  pollTitle: "日程調整",
  pollResultTitle: "日程調整の結果",
  pollLead: "候補日ごとに ○（参加）/△（未定）/×（不可）で回答してください。",
  pollFinalizedLead: "日程は確定済みです。回答の変更はできません。",
  resultStaffOnly: "この結果は現在あなた（スタッフ）にしか表示されていません。",
  /** 候補が無いとき。staff には追加の導線まで添えるので文ごと分けてある
   *  （2つ並べると言語によって間の空きが変わる） */
  noOptions: "候補日はまだありません。",
  noOptionsStaff: "候補日はまだありません。下のカレンダーから追加してください。",

  /** 回答の3択。記号は和文の言い方なので、英語は言葉にする */
  vote_yes: "○",
  vote_maybe: "△",
  vote_no: "×",
  /** 回答数の並び（例「○ 3」）。区切りは common.dotSeparator */
  voteCount: "{{label}} {{n}}",

  /** 候補日1件の日付表記。日付・時刻そのものは Intl が組み立てる */
  optionDay: "（{{weekday}}）",
  optionDayHoliday: "（{{weekday}}・{{holiday}}）",
  /** 日をまたぐ候補の終了側（開始と違う日なので日付から出す） */
  optionEndOtherDay: "{{date}}（{{weekday}}）{{time}}",

  /** 確定まわり。同じ「この日程に決定」でも、印と操作では英語が変わる */
  decidedChip: "この日程に決定",
  decide: "この日程に決定",
  decideConfirm: "この日程に決定しますか？",
  topChip: "参加最多",
  deleteOption: "候補を削除",
  imageRegenerateConfirm:
    "日程が確定しました。イベント画像を確定日時入りで作り直しますか？（手動で設定した画像の場合は上書きされます）",
  imageGenerateFailed: "画像の生成に失敗しました。",
  imageUploadFailed:
    "画像のアップロードに失敗しました。編集画面から設定し直せます。",

  loginToVote: "ログインして回答",
  loginRequired:
    "候補日への回答にはログインが必要です。ログイン後この画面に戻ります。",
  anonymousNote: "回答は匿名です（人数のみ表示）。",
  showResultToAll:
    "日程調整の結果をみんなに表示する（回答してくれた人の一覧など）",
  anonymousVotes: "回答者を匿名にする（誰がどれを選んだか表示しない）",

  /** 候補日の追加（時間帯を1回決めて、カレンダーで日を複数選ぶ） */
  addOptions: "候補日を追加",
  startTime: "開始",
  endTime: "終了",
  /** 開始と終了の入力欄にはさむ記号だけ。日時は入らない */
  timeRangeSeparator: "〜",
  calendarHint: "カレンダーの日付をタップして選択（複数可）",
  adding: "追加中…",
  addSelectedDay: "選択した {{n}} 日を候補に追加",
  addSelectedDays: "選択した {{n}} 日を候補に追加",

  /** タイムテーブル（当日の進行）の共通語 */
  timetable: "タイムテーブル",
  time: "時刻",
  content: "内容",
  speaker: "担当",
  durationMin: "{{n}}分",
  empty: "まだタイムテーブルはありません。右上の編集ボタンから作成できます。",
  viewByTrack: "トラック別に見る",
  edit: "タイムテーブルを編集",
  materialOpen: "登壇資料を開く",
  material: "登壇資料",
  materialEdit: "資料URLを編集",

  /** トラック（並行して走る枠）。トラック名そのものは利用者が入れた値 */
  tracks: "トラック",
  allTracks: "全トラック共通",
  /** 枠に添えるトラック名の連結。common.dotSeparator は前後に空きがあり、
   *  狭い枠では入り切らないのでここだけ空きなしで持つ */
  trackNameSeparator: "・",
  /** 単独トラックの枠は列を見れば分かるので、読み上げにだけ出す名前 */
  trackSrLabel: "トラック{{name}}",
  chooseTrack: "トラックを選ぶ",
  allTracksNote: "全トラック共通のセッションは、どのトラックにも表示されます。",
  trackEmpty: "このトラックのセッションはまだありません。",

  /** トラック別のタイムテーブル画面 */
  backToEvent: "イベントに戻る",
  noTracks:
    "このイベントはトラックを分けていません。タイムテーブルはイベントのページでご覧ください。",
  noTimedSessions:
    "開始時刻が決まっているセッションがまだないため、表として並べられません。",
  undatedHeading: "開始時刻が未定",
  outOfRangeHeading:
    "開始時刻が他のセッションから離れているため表に載せていません",
  unassignedHeading: "未割り当て",
  notShownToParticipants: "参加者には出ません",
  /** 枠の描き分けの凡例。「全トラック共通」は allTracks を使う */
  legendSingleTrack: "特定のトラック",
  legendSpanning: "複数のトラックにまたがる",

  /** 編集画面の骨組み */
  unassignedSection: "未割り当て（ネタ出し）",
  unassignedSectionHint:
    "時刻はまだ決まりません。参加者には表示されません。「配置する」で下の配置済みへ移ります。",
  unassignedEmpty: "ネタ出し中のセッションはありません。",
  addIdea: "ネタを追加",
  placedSection: "配置済み",
  addRow: "行を追加",
  templateConfirm: "現在の内容をテンプレートで置き換えますか？",
  reloadConfirm:
    "最新のタイムテーブルを読み込み直します。この画面の編集内容は失われます。よろしいですか？",
  removeTrackConfirmOne:
    "このトラックにだけ載っている{{n}}件のセッションは未割り当てに戻ります。削除しますか？",
  removeTrackConfirm:
    "このトラックにだけ載っている{{n}}件のセッションは未割り当てに戻ります。削除しますか？",

  /** タイムテーブルのテンプレート名。キーは SCHEDULE_TEMPLATES の key */
  templateName_lt: "LT会",
  templateName_study: "勉強会",
  templateName_hackathon: "ハッカソン",
  "templateName_study-party": "懇親会つき勉強会",

  /** 同じトラック内で時刻が重なったときの警告（保存は止めない） */
  overlapTitle: "同じトラック内で時刻が重なっています。",
  overlapNote:
    "このままでも保存できますが、タイムテーブルの枠が重なって読みにくくなります。",
  overlapItem:
    "{{track}}: 「{{a}}」({{aStart}}〜) と「{{b}}」({{bStart}}〜) が重なっています",
  overlapMore: "ほか{{n}}件",
  untitled: "(無題)",

  /** 編集の1行（1コマ） */
  dragToReorder: "ドラッグで並び替え",
  hiddenMember: "(表示できないメンバー)",
  durationLabel: "所要（分）",
  speakerFieldLabel: "担当（メンバー or 自由入力）",
  startsAtLabel: "開始時刻を指定（任意）",
  descriptionLabel: "説明（任意）",
  materialUrlLabel: "資料URL（任意・Speaker Deck / Googleスライド / デッキ等）",
  unassignedChip: "未割り当て（参加者には出ません）",
  place: "配置する",
  unnamedTrack: "(名前なし)",
  commonToggle: "全体共通",
  backToUnassigned: "未割り当てに戻す",
  deleteRow: "この行を削除",

  /** トラックの管理 */
  trackNameLabel: "トラック{{n}}の名前",
  /** 追加したトラックの仮の名前。**保存されるデータ**なので、付けた人の
   *  言語で残る（あとから自由に書き換えられる） */
  defaultTrackName: "トラック{{n}}",
  moveTrackUp: "このトラックを前へ",
  moveTrackDown: "このトラックを後ろへ",
  removeTrack: "このトラックを削除",
  addTrack: "トラックを追加",
  trackRemoveNote:
    "トラックを削除すると、そのトラックにだけ載っていたセッションは未割り当てに戻ります。",
  trackAddHint: "同じ時間に並行して走る枠がある場合に追加します。",

  /** 同時編集のお知らせ (#340)。呼び方だけ差し替えて文は1つにする */
  editorNamed: "{{name}}さん",
  editorOther: "ほかの運営メンバー",
  editingBy: "{{editor}}がいまタイムテーブルを編集しています。",
  editingByShort: "{{editor}}が編集中",
  editingNote:
    "このまま編集できますが、先に相手が保存すると、あとから保存したほうは上書きを避けるために止まります。担当を分けるか、相手の保存を待ってから保存してください。",
  saveFailedTitle: "タイムテーブルを保存できませんでした",
  saveFailedBody: "通信の状態を確かめて、もう一度保存してください。",
  saveFailedStale:
    "それでも保存できないときは、この画面を開いてから時間が経ちすぎている可能性があります。変えたかった箇所を控えてからページを読み込み直すと、保存できるようになります。",
  conflictTitle: "ほかの人が先にタイムテーブルを更新しました",
  conflictBody:
    "あなたが編集を始めたあとに更新が入ったため、相手の変更を消さないよう保存を中止しました。いまの編集内容はこの画面に残っています。",
  conflictHowTo:
    "変えたかった箇所を控えてから「最新を読み込む」を押し、最新のタイムテーブルに入れ直してください。",
  reloadLatest: "最新を読み込む",
} as const;

const en: Record<keyof typeof ja, string> = {
  pollTitle: "Pick a date",
  pollResultTitle: "Date poll results",
  pollLead:
    "Tell everyone whether you can make each option: Yes, Maybe, or No.",
  pollFinalizedLead: "The date is settled. Answers can no longer be changed.",
  resultStaffOnly: "Right now only you, as an organizer, can see these results.",
  noOptions: "No date options yet.",
  noOptionsStaff: "No date options yet. Add some from the calendar below.",

  vote_yes: "Yes",
  vote_maybe: "Maybe",
  vote_no: "No",
  voteCount: "{{label}} {{n}}",

  optionDay: " ({{weekday}})",
  optionDayHoliday: " ({{weekday}}, {{holiday}})",
  optionEndOtherDay: "{{date}} ({{weekday}}) {{time}}",

  decidedChip: "Confirmed",
  decide: "Pick this date",
  decideConfirm: "Settle on this date?",
  topChip: "Most available",
  deleteOption: "Remove this option",
  imageRegenerateConfirm:
    "The date is settled. Regenerate the event image with the confirmed date and time? (An image you uploaded yourself will be replaced.)",
  imageGenerateFailed: "Couldn't generate the image.",
  imageUploadFailed:
    "Couldn't upload the image. You can set it again from the edit screen.",

  loginToVote: "Sign in to answer",
  loginRequired:
    "You need to sign in to answer. We'll bring you back to this page afterwards.",
  anonymousNote: "Answers are anonymous — only the totals are shown.",
  showResultToAll:
    "Show the date poll results to everyone, including who answered what",
  anonymousVotes: "Keep answers anonymous, so nobody sees who picked what",

  addOptions: "Add date options",
  startTime: "Start",
  endTime: "End",
  timeRangeSeparator: "–",
  calendarHint: "Tap the days you want on the calendar — you can pick several.",
  adding: "Adding…",
  addSelectedDay: "Add {{n}} selected day",
  addSelectedDays: "Add {{n}} selected days",

  timetable: "Timetable",
  time: "Time",
  content: "Session",
  speaker: "Speaker",
  durationMin: "{{n}} min",
  empty: "No timetable yet. Use the edit button above to build one.",
  viewByTrack: "View by track",
  edit: "Edit the timetable",
  materialOpen: "Open the slides",
  material: "Slides",
  materialEdit: "Edit the slides link",

  tracks: "Tracks",
  allTracks: "All tracks",
  trackNameSeparator: ", ",
  trackSrLabel: "Track: {{name}}",
  chooseTrack: "Choose a track",
  allTracksNote: "Sessions marked for all tracks appear under every track.",
  trackEmpty: "No sessions on this track yet.",

  backToEvent: "Back to the event",
  noTracks:
    "This event doesn't use tracks. You'll find its timetable on the event page.",
  noTimedSessions:
    "No session has a start time yet, so there is nothing to lay out on the grid.",
  undatedHeading: "Start time not set",
  outOfRangeHeading:
    "Left off the grid: the start time is far from every other session",
  unassignedHeading: "Unassigned",
  notShownToParticipants: "Hidden from participants",
  legendSingleTrack: "One track",
  legendSpanning: "Spans several tracks",

  unassignedSection: "Unassigned (ideas)",
  unassignedSectionHint:
    "These have no start time and stay hidden from participants. Use “Place it” to move one down to the scheduled list.",
  unassignedEmpty: "No ideas parked here.",
  addIdea: "Add an idea",
  placedSection: "Scheduled",
  addRow: "Add a row",
  templateConfirm: "Replace everything here with the template?",
  reloadConfirm:
    "This reloads the latest timetable and discards the edits on this screen. Continue?",
  removeTrackConfirmOne:
    "{{n}} session is only on this track and will go back to unassigned. Delete the track?",
  removeTrackConfirm:
    "{{n}} sessions are only on this track and will go back to unassigned. Delete the track?",

  templateName_lt: "Lightning talks",
  templateName_study: "Study session",
  templateName_hackathon: "Hackathon",
  "templateName_study-party": "Study session with a social",

  overlapTitle: "Some sessions overlap within the same track.",
  overlapNote:
    "You can still save, but overlapping blocks make the timetable hard to read.",
  overlapItem:
    "{{track}}: “{{a}}” (from {{aStart}}) overlaps “{{b}}” (from {{bStart}})",
  overlapMore: "{{n}} more",
  untitled: "(untitled)",

  dragToReorder: "Drag to reorder",
  hiddenMember: "(member not shown)",
  durationLabel: "Length (min)",
  speakerFieldLabel: "Speaker (member or free text)",
  startsAtLabel: "Fixed start time (optional)",
  descriptionLabel: "Description (optional)",
  materialUrlLabel:
    "Slides URL (optional — Speaker Deck, Google Slides, and the like)",
  unassignedChip: "Unassigned (hidden from participants)",
  place: "Place it",
  unnamedTrack: "(no name)",
  commonToggle: "All tracks",
  backToUnassigned: "Back to unassigned",
  deleteRow: "Delete this row",

  trackNameLabel: "Name of track {{n}}",
  defaultTrackName: "Track {{n}}",
  moveTrackUp: "Move this track earlier",
  moveTrackDown: "Move this track later",
  removeTrack: "Delete this track",
  addTrack: "Add a track",
  trackRemoveNote:
    "Deleting a track sends any session that was only on it back to unassigned.",
  trackAddHint: "Add one when sessions run in parallel at the same time.",

  editorNamed: "{{name}}",
  editorOther: "Another organizer",
  editingBy: "{{editor}} is editing the timetable right now.",
  editingByShort: "{{editor}} is editing",
  editingNote:
    "You can keep editing, but if they save first, your save will stop to avoid overwriting their work. Split the work between you, or wait until they have saved.",
  saveFailedTitle: "Couldn't save the timetable",
  saveFailedBody: "Check your connection and try saving again.",
  saveFailedStale:
    "If it still won't save, this screen may have been open for too long. Note down what you changed, reload the page, and you'll be able to save again.",
  conflictTitle: "Someone else updated the timetable first",
  conflictBody:
    "An update landed after you started editing, so we stopped the save rather than wipe out their changes. Your edits are still here on this screen.",
  conflictHowTo:
    "Note down what you changed, press “Load the latest”, and put your changes into the fresh timetable.",
  reloadLatest: "Load the latest",
};

export const schedule = { ja, en };
