/**
 * 準備の段取り (#393)、スタッフチャット (#382)、役割と持ち場 (#384)。
 *
 * どれも**実装上の語を出さない**。当日のタイムラインへの導線と保存の失敗は
 * 画面をまたぐので `checkin.ts` の `toTimetable` / `saveFailed` を引く。
 */
const ja = {
  /* ── 準備の段取り (#393) ────────────────────────────────
   * **実装上の語を出さない。**「待ち」「担当者が外れています」のように
   * 振る舞いで書く（`assigneeState` / `dep` / `blocked` は利用者の語彙ではない） */
  todoTitle: "準備TODO",
  todoStaffOnly: "準備TODOはスタッフ専用です。",
  /** 当日の段取り (#383) との線引き。TODO 側とタイムライン側の両方に出す */
  todoScopeNote:
    "日付だけで決める当日より前の仕事はここに。時刻があり当日の段取りになるものはタイムラインへ。",
  todoFromTimetable: "準備TODOへ",
  todoEmpty: "まだ登録がありません。",
  todoFilterNone: "この条件に合う仕事はありません。",
  /** 進み具合。百分率は持たず、この4つの数で見せる */
  todoCountOpen: "未完了 {{n}}",
  todoCountOverdue: "遅れ {{n}}",
  todoCountBlocked: "待ち {{n}}",
  todoCountDone: "完了 {{n}}",
  /** 絞り込みのチップ。集計チップ（「遅れ 3」）や行の印（「遅れ」）と
   * **同じ綴りにしない**。同じ画面に同じ言葉のものが3つ並ぶと、
   * どれを押すと何が起きるのかが読めない */
  todoFilterMine: "自分の担当",
  todoFilterUnassigned: "未割り当てのみ",
  todoFilterLeft: "担当者が外れた",
  todoFilterOverdue: "遅れだけ",
  todoFilterShowDone: "完了を含める",
  todoUnassigned: "未割り当て",
  /** 担当を外れた人の名前は**出さない**（退会が混ざるため） */
  todoAssigneeLeft: "担当者が外れています（要再割り当て）",
  todoBlockedChip: "待ち",
  todoOverdueChip: "遅れ",
  todoCycleChip: "先の仕事が輪になっています",
  todoNoDates: "日付未定",
  todoDependsOnChip: "⟵ {{title}}",
  todoDeleteConfirm: "「{{title}}」を削除しますか？",
  todoFieldTitle: "やること",
  todoFieldNote: "補足",
  todoFieldStartsOn: "開始日",
  todoFieldDueOn: "期限",
  todoFieldAssignee: "担当",
  todoDepsField: "先に終わらせる仕事",
  todoDepsHelp: "ここで選んだ仕事が終わるまで、この仕事は待ちになります。",
  todoGanttTitle: "日程",
  todoGanttEmpty: "開始日か期限を入れると、ここに帯が出ます。",
  todoGanttOutside: "この期間の外にある仕事が {{n}} 件あります（一覧には出ます）。",
  /** 全項目が窓より長いときのフォールバック。帯を窓の端で切ったことの注記 */
  todoGanttClipped: "予定が長すぎて描ききれない仕事が {{n}} 件あります（帯は途中まで）。",
  todoGanttToday: "今日",
  todoGanttSelectHint: "行を選ぶと、つながる仕事との線が出ます。",
  /** 目盛りの月。細い列のときは月だけを書く */
  todoGanttMonth: "{{n}}月",
  todoLimitError: "このイベントに登録できる数の上限に達しています。",
  todoDepLimitError: "先に終わらせる仕事を、これ以上は選べません。",
  todoDepCycleError: "その組み合わせは、お互いを待ち合う輪になってしまいます。",
  todoAssigneeNotStaffError:
    "担当にできるのは、このイベントのスタッフとして参加が確定している人だけです。",
  todoBadRangeError: "開始日が期限より後になっています。",

  /* ── スタッフチャット (#382) ─────────────────────────────
   * **実装技術名（Nostr・暗号方式・リレー等）は出さない。** 振る舞い
   * （スタッフだけが読める・運営サービスには見える）だけを伝える */
  staffChatTitle: "スタッフチャット",
  staffChatStaffOnly: "スタッフチャットはこのイベントのスタッフ専用です。",
  staffChatNotice:
    "このチャットはスタッフだけが読めます。内容は暗号化されて外部サーバーに保存されます（運営サービスには内容が見えます）。",
  staffChatOpenFailed:
    "チャットを開けませんでした。ページを再読み込みしてもう一度お試しください。",

  /* ── 役割と持ち場 (#384) ────────────────────────────────
   * **実装上の語を出さない。** duty / slot / assignee は利用者の語彙ではないので
   * 「役割」「持ち場」「担当」で書く。タグ本体（「受付 1/2」）は名前と数字の
   * 組み立てなので辞書には持たない */
  dutyTitle: "役割と持ち場",
  dutyStaffOnly: "役割と持ち場はスタッフ専用です。",
  dutyPageNote:
    "時間帯ごとに「どの役割が何人要るか」を先に置き、あとから人を割り当てます。人数が先にあるので、埋まっていない持ち場が分かります。",
  dutyDefsTitle: "役割",
  dutyDefsNote:
    "このイベントで使う役割（受付・司会・配信など）。イベントを複製すると名前ごとコピーされます。",
  dutyAddPlaceholder: "役割の名前（例: 受付）",
  dutyAddButton: "追加",
  dutyRenameTitle: "役割の名前を変える",
  /** 使っている持ち場ごと消えることを、消す前に必ず伝える */
  dutyDeleteConfirm:
    "「{{name}}」を削除しますか？ {{n}} か所の持ち場と、その割り当ても消えます。",
  dutyDeleteConfirmUnused: "「{{name}}」を削除しますか？",
  dutyUnfilledCount: "埋まっていない持ち場 {{n}}",
  dutyAllFilled: "すべての持ち場が埋まっています。",
  /** 絞り込みのチップ。集計チップ（上）と同じ綴りにしない（todoFilter と同じ理由） */
  dutyFilterShort: "不足のみ",
  dutyFilterMine: "自分の持ち場",
  dutyFilterNone: "この条件に合う時間帯はありません。",
  dutyNoItems:
    "タイムテーブルに時間帯がありません。先にタイムテーブルを作ってください。",
  dutyNoDuties: "まず役割を作ってください。",
  dutyNoSlots: "持ち場なし",
  dutyNoTime: "時刻未定",
  dutyEditSlots: "持ち場を編集",
  dutySlotsDialogTitle: "持ち場と割り当て",
  dutySlotAdd: "持ち場を足す",
  dutyRequiredLabel: "必要人数",
  dutySlotRemove: "外す",
  dutySlotRemoveConfirm:
    "「{{name}}」の持ち場を外しますか？ 割り当ても消えます。",
  dutyAssignLabel: "割り当てる人",
  dutyAssignButton: "割り当てる",
  /** 外れた担当の名前は**出さない**（退会が混ざるため。#393 と同じ規則） */
  dutyAssigneeLeft: "外れた割り当てがあります。外して再割り当てしてください。",
  dutyAssigneeLeftShort: "外れた担当",
  dutyLimitError: "このイベントに作れる役割の数の上限に達しています。",
  dutyNameTakenError: "同じ名前の役割がすでにあります。",
  dutySlotLimitError: "この時間帯に置ける持ち場の数の上限に達しています。",
  dutyRequiredRangeError: "必要人数の指定が正しくありません。",
  dutyAssigneeNotStaffError:
    "割り当てられるのは、このイベントのスタッフとして参加が確定している人だけです。",
  dutyAssigneeLimitError: "この持ち場に割り当てられる人数の上限に達しています。",
  dutyAssigneeDupError: "その人はすでにこの持ち場に割り当てられています。",
} as const;

const en: Record<keyof typeof ja, string> = {
  todoTitle: "Prep to-dos",
  todoStaffOnly: "Prep to-dos are for organizers only.",
  todoScopeNote:
    "Work that happens before the day, decided by date, belongs here. Anything with a time on the day itself belongs in the timetable.",
  todoFromTimetable: "Go to prep to-dos",
  todoEmpty: "Nothing here yet.",
  todoFilterNone: "Nothing matches these filters.",
  todoCountOpen: "{{n}} to do",
  todoCountOverdue: "{{n}} late",
  todoCountBlocked: "{{n}} waiting",
  todoCountDone: "{{n}} done",
  todoFilterMine: "Assigned to me",
  todoFilterUnassigned: "Unassigned only",
  todoFilterLeft: "Owner stepped down",
  todoFilterOverdue: "Late only",
  todoFilterShowDone: "Include finished",
  todoUnassigned: "Nobody assigned",
  todoAssigneeLeft: "The person who owned this stepped down — assign someone.",
  todoBlockedChip: "Waiting",
  todoOverdueChip: "Late",
  todoCycleChip: "These jobs wait on each other in a loop",
  todoNoDates: "No dates yet",
  todoDependsOnChip: "⟵ {{title}}",
  todoDeleteConfirm: "Delete “{{title}}”?",
  todoFieldTitle: "What needs doing",
  todoFieldNote: "Notes",
  todoFieldStartsOn: "Start date",
  todoFieldDueOn: "Due date",
  todoFieldAssignee: "Owner",
  todoDepsField: "Finish these first",
  todoDepsHelp: "This job waits until everything you pick here is finished.",
  todoGanttTitle: "Dates",
  todoGanttEmpty: "Add a start or due date and a bar shows up here.",
  todoGanttOutside:
    "{{n}} job(s) fall outside this range (they are still in the list).",
  todoGanttClipped:
    "{{n}} job(s) run longer than the chart shows — their bars are cut off.",
  todoGanttToday: "Today",
  todoGanttSelectHint: "Pick a row to see the lines to the jobs it connects to.",
  todoGanttMonth: "M{{n}}",
  todoLimitError: "This event has reached the limit for prep to-dos.",
  todoDepLimitError: "You cannot pick any more jobs to finish first.",
  todoDepCycleError: "That would leave these jobs waiting on each other forever.",
  todoAssigneeNotStaffError:
    "Only organizers whose place at this event is confirmed can own a job.",
  todoBadRangeError: "The start date is after the due date.",

  staffChatTitle: "Staff chat",
  staffChatStaffOnly: "The staff chat is only for this event's organizers.",
  staffChatNotice:
    "Only organizers can read this chat. Messages are encrypted and stored on an external server (the service operator can read them).",
  staffChatOpenFailed: "Could not open the chat. Reload the page and try again.",

  dutyTitle: "Roles & posts",
  dutyStaffOnly: "Roles and posts are for organizers only.",
  dutyPageNote:
    "First decide which roles each time slot needs and how many people, then assign people. Because the headcount comes first, you can see which posts are still unfilled.",
  dutyDefsTitle: "Roles",
  dutyDefsNote:
    "The roles this event uses (front desk, MC, streaming and so on). Duplicating the event copies them by name.",
  dutyAddPlaceholder: "Role name (e.g. Front desk)",
  dutyAddButton: "Add",
  dutyRenameTitle: "Rename this role",
  dutyDeleteConfirm:
    "Delete “{{name}}”? Its {{n}} post(s) and their assignments will be removed too.",
  dutyDeleteConfirmUnused: "Delete “{{name}}”?",
  dutyUnfilledCount: "{{n}} unfilled post(s)",
  dutyAllFilled: "Every post is filled.",
  dutyFilterShort: "Unfilled only",
  dutyFilterMine: "My posts",
  dutyFilterNone: "No time slots match these filters.",
  dutyNoItems:
    "The timetable has no time slots yet. Build the timetable first.",
  dutyNoDuties: "Create a role first.",
  dutyNoSlots: "No posts",
  dutyNoTime: "No time yet",
  dutyEditSlots: "Edit posts",
  dutySlotsDialogTitle: "Posts & assignments",
  dutySlotAdd: "Add a post",
  dutyRequiredLabel: "People needed",
  dutySlotRemove: "Remove",
  dutySlotRemoveConfirm:
    "Remove the “{{name}}” post? Its assignments will be removed too.",
  dutyAssignLabel: "Assign someone",
  dutyAssignButton: "Assign",
  dutyAssigneeLeft:
    "Someone assigned here has stepped down — remove them and assign someone else.",
  dutyAssigneeLeftShort: "Stepped down",
  dutyLimitError: "This event has reached the limit for roles.",
  dutyNameTakenError: "A role with that name already exists.",
  dutySlotLimitError: "This time slot has reached its limit for posts.",
  dutyRequiredRangeError: "That number of people is not allowed.",
  dutyAssigneeNotStaffError:
    "Only organizers whose place at this event is confirmed can be assigned.",
  dutyAssigneeLimitError: "This post has reached its limit for assignments.",
  dutyAssigneeDupError: "That person is already assigned to this post.",
};

export const prep = { ja, en };
