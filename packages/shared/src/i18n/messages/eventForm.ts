/**
 * イベントの作成・編集フォームの文言 (#363)。
 *
 * 対象は作成ページ・編集ページと、そこに載る部品（参加枠・事前アンケート・
 * 画像・資料）。イベント詳細で読む側の文言は `eventDetail.ts`、
 * 一覧は `events.ts` が持つので、同じ文言をここに増やさない。
 */
// 数の入れ替えは {{n}} を使う。i18next の `count` は複数形の仕組みを
// 起動してしまい、`_other` を用意していないキーで挙動が読みにくくなるため。
const ja = {
  /** ページの見出しと、開けなかったとき */
  createTitle: "イベント作成",
  editTitle: "イベント編集",
  noPermission: "このイベントの編集権限がありません。",

  /** 公開状態（編集ページのみ。作成は必ず下書きから始まる） */
  statusHeading: "公開状態",
  statusDraft: "非公開（下書き）",
  statusPublished: "公開",
  statusHelp:
    "公開にすると未ログインでも閲覧でき、開催前なら公開トップの一覧に表示されます。",

  /** 本文まわりの入力欄 */
  title: "タイトル",
  subtitle: "サブタイトル（任意）",
  description: "内容",
  markdownHelp:
    "Markdown が使えます（見出し #、リスト -、リンク [text](url)、**強調**、<img> など）",
  membersNote: "参加者限定の文章（参加確定した人にだけ表示）",
  membersNoteHelp:
    "Discord の招待リンクや当日の連絡事項など、参加確定者とスタッフにだけ見せたい内容を書けます。Markdown が使えます",

  /** 主催コミュニティ */
  community: "コミュニティ（任意）",
  communityHelp:
    "主催コミュニティに紐付けると、そのコミュニティページに表示されます",
  communityNone: "なし",

  /** 日程 */
  scheduling: "日程調整（日程未定で公開。候補日に参加者が○△×で回答）",
  scheduleAnonymous: "回答者を匿名にする（人数のみ表示。大人数向け）",
  startsAt: "開始日時",
  endsAt: "終了日時",
  schedulingNotice:
    "このイベントは日程調整中です。イベントページの日程調整で確定するか、ここで日時を直接設定できます（直接設定すると日程調整は終了します）。",
  setDateDirectly: "日時を直接設定する",

  /** 募集締切 (#269)。開催日時が決まるまでは入力できない */
  deadline: "募集締切日時（任意）",
  deadlineHelp:
    "空欄なら締切なしで、イベント終了まで受け付けます。締切を過ぎると新しい参加登録だけができなくなります（参加者のキャンセルやスタッフの操作はそのまま行えます）。",
  deadlineDisabledHelp:
    "開催日時が決まっていないため設定できません。開始日時と終了日時を入力すると設定できるようになります。",
  /** 締切まわりの断り。共通の辞書より一歩踏み込んで、何を直せばよいかまで書く */
  deadlineAfterStart:
    "募集締切は開始日時より後にできません。開催中も受け付けるなら空欄にしてください。",
  deadlineNeedsDate:
    "募集締切を設定するには、先に開始日時と終了日時を入力してください。",

  /** 会場 */
  venueType: "会場種別",
  venueOffline: "オフライン会場",
  venueOnline: "オンライン会場（Discord 招待 URL など）",
  venueWanted: "会場を探しています",
  venueWantedHelp:
    "オンにすると会場提供者からのオファーを受け付けます（会場募集一覧にも掲載）。",

  /** イベントの性格を決めるスイッチ。説明文は作成と編集で少し違う */
  contestMode: "コンテスト形式（採点・成果物・表彰を使う）",
  contestModeHelpCreate:
    "オフなら告知・募集だけの一般イベントになります（採点や表彰は表示されません）。あとから変更できます。",
  contestModeHelpEdit:
    "オフなら告知・募集だけの一般イベントになり、採点・成果物・表彰は表示されません。",
  attendanceCheck: "出席チェックモード",
  attendanceCheckHelp:
    "オンにすると、スタッフが出席チェックした人だけが参加者として記録されます。チェックされなかった人は参加人数・参加履歴に含まれません（当日受付・ドタキャン対策に）。",
  chat: "参加者チャット",
  chatHelp:
    "参加確定メンバーがイベントページでチャットできます。チャットの内容は公開されます。",
  chatUrls: "参加者のURL投稿を許可",
  chatUrlsHelp:
    "オンにすると参加者もチャットにURLを投稿できます。スタッフは常に投稿できます。",
  qa: "Q&A（質問と投票）",
  qaHelp:
    "参加確定メンバーが質問を投稿し、聞きたい質問に投票できます。票の多い順に並ぶので、登壇者は人気の質問から答えられます。",
  qaAnonymity: "質問の名前の出し方",
  qaAnonymityHelp:
    "「参加者が選べる」にすると、投稿するときに本人が名前を出すかどうかを決められます。いずれの設定でも、荒らし対応のためスタッフには投稿者が表示されます。",
  /** 質問の名前の出し方 (`QaAnonymity`)。並びはコード側が持つ */
  qaAnonymityReal: "実名のみ",
  qaAnonymityAnon: "匿名のみ",
  qaAnonymityChoice: "参加者が選べる",

  /** 作成ページの結び。たまご（あったらいいな）から作った場合の紐付け失敗も含む */
  createSubmit: "作成",
  createError: "作成に失敗しました。入力内容を確認してください。",
  linkFailed: "イベントは作成されましたが、たまごへの紐付けに失敗しました。",
  linkSkip: "紐付けせずイベントへ",
  linkRetry: "紐付けを再試行",

  /** 編集ページの結び */
  saveError: "保存に失敗しました。",
  duplicateHeading: "イベントの複製",
  duplicateButton: "イベントを複製",
  duplicateHelp:
    "タイトル・説明・参加枠・採点基準・表彰・画像などをコピーした下書きイベントを新しく作ります。",
  duplicateConfirm:
    "このイベントを複製しますか？（参加者・エントリー・コメント・写真はコピーされません）",
  duplicateError: "複製に失敗しました。",
  dangerZone: "危険な操作",
  deleteButton: "このイベントを削除",
  deleteConfirm: "本当に削除しますか？（参加者・採点・画像も削除されます）",
  deleteAbort: "やめる",
  deleteSubmit: "削除する",

  /** 参加枠。編集する側（スタッフ）と読む側（参加者）で同じ言い方を使う */
  slotsHeading: "参加枠",
  slotsEditorHeading: "参加枠（定員・先着/抽選）",
  manageApplicants: "申込者の管理",
  slotsEmpty:
    "まだ参加枠がありません。下の「追加」ボタンで枠を追加できます（枠なしの場合は定員なしで参加できます）。",
  slotName: "枠名",
  slotCapacity: "定員",
  slotSelection: "方式",
  /** 選び方 (`SelectionType`)。並びはコード側が持つ */
  slotTypeFirstCome: "先着順",
  slotTypeLottery: "抽選",
  /** 人数の内訳。区切りの記号は common.dotSeparator が持つ */
  slotConfirmedOfCapacity: "確定 {{n}}/{{total}}",
  slotConfirmedCapacity: "確定 {{n}} / 定員 {{total}}",
  slotAppliedCount: "抽選申込 {{n}}",
  slotWaitlistCount: "キャンセル待ち {{n}}",
  slotDrawAt: "抽選日時（任意）",
  slotDrawAtLabel: "抽選日時: {{date}}",
  slotDraw: "自動抽選（申込 {{n}} → 定員 {{total}}）",
  slotAddHeading: "枠を追加",
  slotAdd: "追加",
  /** 枠ごとの申込ボタン。満席の先着枠はキャンセル待ちになる */
  slotJoin: "参加する",
  slotJoinLottery: "抽選に申し込む",
  slotJoinWaitlist: "キャンセル待ちで申込",

  /** 事前アンケート (#152)。質問を作る側 */
  surveyHeading: "参加アンケート",
  surveyHelp:
    "参加登録時に回答してもらう質問です（入館用の氏名・所属の収集など）。必須の質問に未回答の人は参加登録できません。回答はスタッフだけが閲覧できます。",
  surveyAnswersExist:
    "すでに回答が集まっています。質問の追加・必須化は今後の参加者にのみ適用されます（既存参加者の未回答はアクセス統計の回答一覧で確認できます）。",
  surveyQuestion: "質問",
  surveyQtype: "回答形式",
  surveyOptions: "選択肢（カンマ区切り）",
  surveyOptionsExample: "例: 参加, 不参加",
  surveyRequired: "必須（未回答だと参加登録できない）",
  /** 回答形式 (`SurveyQtype`)。並びはコード側が持つ */
  qtypeText: "自由記述",
  qtypeSelect: "単一選択",
  qtypeCheckbox: "複数選択",
  surveyQuestionRequired: "質問を入力してください",
  surveyOptionsRequired: "選択肢をカンマ区切りで1つ以上入力してください",
  surveyDeleteQuestion: "この質問を削除",
  surveyDeleteConfirm:
    "この質問を削除しますか？（保存すると集まった回答も削除されます）",
  surveyTemplateConfirm:
    "現在の質問をテンプレートで置き換えますか？（保存すると既存質問の回答は消えます）",
  /** 消える回答の件数。英語が「1 answers」にならないよう単数用と複数用を分ける
   *  （日本語はどちらも同じ綴り。**どちらを使うかは数だけで決まる**） */
  surveyLoseAnswer: "この変更で {{n}} 件の回答が削除されます。よろしいですか？",
  surveyLoseAnswers: "この変更で {{n}} 件の回答が削除されます。よろしいですか？",
  surveySaveError: "アンケートの保存に失敗しました。",
  surveySaved: "アンケートを保存しました。",
  surveyAddQuestion: "質問を追加",
  surveyFromTemplate: "テンプレから作成",
  surveySave: "アンケートを保存",

  /** 事前アンケートの回答フォーム。参加前の回答と参加後の編集に共用 */
  surveyAnswerNotice: "回答はこのイベントのスタッフだけが閲覧できます。",
  surveySelectRequired: "選択してください",
  surveyCheckRequired: "1つ以上選択してください",
  surveyInputRequired: "入力してください",
  surveySubmitError: "回答の送信に失敗しました。",

  /** イベント画像。作成ページは任意、編集ページは差し替え */
  imageHeading: "イベント画像（OG画像 {{width}}×{{height}}）",
  imageHeadingOptional: "イベント画像（OG画像 {{width}}×{{height}}・任意）",
  imageModeUpload: "アップロード",
  imageModeTemplate: "テンプレートで作る",
  imageSelect: "画像を選択",
  imageAdd: "画像を追加",
  imageChange: "画像を変更",
  imageRemove: "削除",
  imageNone: "画像は未設定です",
  imageUploadError: "アップロードに失敗しました（1MB以内の画像）",
  /** 日程未定のイベントを自動生成するときに画像へ描く字 */
  imageSchedulingSubtitle: "日程調整中",

  /** テンプレートから画像を作る画面 */
  imageShuffle: "おまかせ（ランダム）",
  imageFont: "フォント",
  /** フォントの分類。分類そのもの（コード）は imageTemplates.ts が持つ */
  imageFontGothic: "ゴシック",
  imageFontRounded: "丸ゴシック",
  imageFontMincho: "明朝",
  imageFontDisplay: "手書き・個性派",
  imageBackground: "背景",
  imageLayout: "レイアウト",
  imageLayoutCenter: "中央",
  imageLayoutLeft: "左寄せ",
  imageLayoutTop: "上寄せ",
  imageTitleSize: "文字サイズ",
  imageShowDate: "日付を表示",
  imageHideDate: "日付を隠す",
  imageUse: "この画像を使う",

  /** 画像の切り抜き */
  cropTitle: "クロップ範囲を指定",
  cropZoom: "ズーム",
  cropApply: "適用",

  /** Markdown 入力欄の編集／プレビュー切替。
   *  日本語は `eventDetail.edit`（イベントを編集するボタン）と同じ綴りだが、
   *  こちらは入力欄のタブなので英語は "Write"。**別物なので共通化しない** */
  markdownEdit: "編集",
  markdownPreview: "プレビュー",
  markdownEmptyPreview: "プレビューする内容がありません。",

  /** 登壇資料のギャラリーと、登壇者本人による資料URLの編集。
   *  見出し・編集ボタン・未割り当ての印はタイムテーブルと同じ言い方なので
   *  `schedule.material` / `schedule.materialEdit` / `schedule.unassignedChip` を使う */
  materialOpen: "登壇資料を開く: {{title}}",
  materialUrlTitle: "登壇資料URL",
  materialUrlLabel: "資料URL（Speaker Deck / Googleスライド / デッキ等）",
  materialUrlInvalid: "http(s):// で始まるURLを入力してください",
  materialUrlHelp: "空にすると資料リンクを外せます",
  materialSaveError: "資料URLの保存に失敗しました。",
} as const;

const en: Record<keyof typeof ja, string> = {
  createTitle: "Create an event",
  editTitle: "Edit event",
  noPermission: "You cannot edit this event.",

  statusHeading: "Visibility",
  statusDraft: "Private (draft)",
  statusPublished: "Public",
  statusHelp:
    "Public events can be read without signing in, and upcoming ones are listed on the front page.",

  title: "Title",
  subtitle: "Subtitle (optional)",
  description: "About",
  markdownHelp:
    "Markdown works here: # for headings, - for lists, [text](url) for links, **bold**, <img>, and so on",
  membersNote: "Note for participants (shown only once they are confirmed)",
  membersNoteHelp:
    "Use this for Discord invites or day-of details you only want confirmed participants and organizers to see. Markdown works here",

  community: "Community (optional)",
  communityHelp:
    "Linking the event to a community you run makes it show up on that community's page",
  communityNone: "None",

  scheduling:
    "Find a date together (publish without a date; participants answer yes / maybe / no on each option)",
  scheduleAnonymous:
    "Hide who answered (show counts only — better for large events)",
  startsAt: "Starts at",
  endsAt: "Ends at",
  schedulingNotice:
    "This event is still looking for a date. Settle it from the date poll on the event page, or set the times directly here (doing so ends the poll).",
  setDateDirectly: "Set the times directly",

  deadline: "Registration deadline (optional)",
  deadlineHelp:
    "Leave it empty to keep taking registrations until the event ends. After the deadline only new registrations stop — participants can still cancel, and organizers can still make changes.",
  deadlineDisabledHelp:
    "You cannot set a deadline until the event has a date. Fill in the start and end times to unlock it.",
  deadlineAfterStart:
    "The deadline cannot be later than the start time. Leave it empty to keep taking registrations during the event.",
  deadlineNeedsDate:
    "Fill in the start and end times before setting a registration deadline.",

  venueType: "Format",
  venueOffline: "Venue",
  venueOnline: "Online venue (a Discord invite URL, for example)",
  venueWanted: "Looking for a venue",
  venueWantedHelp:
    "Turn this on to receive offers from venue hosts. Your event also appears in the list of events looking for a venue.",

  contestMode: "Contest (scoring, submissions and awards)",
  contestModeHelpCreate:
    "Leave it off for a plain event that only announces and takes registrations — no scoring, no awards. You can change this later.",
  contestModeHelpEdit:
    "Leave it off for a plain event that only announces and takes registrations. Scoring, submissions and awards stay hidden.",
  attendanceCheck: "Attendance check",
  attendanceCheckHelp:
    "When this is on, only people an organizer checks in count as participants. Anyone left unchecked is excluded from the participant count and from attendance history — handy for door check-in and no-shows.",
  chat: "Participant chat",
  chatHelp:
    "Confirmed participants can chat on the event page. Anything posted there is public.",
  chatUrls: "Let participants post URLs",
  chatUrlsHelp:
    "When this is on, participants can post URLs in chat too. Organizers always can.",
  qa: "Q&A (questions and votes)",
  qaHelp:
    "Confirmed participants can post questions and vote for the ones they want answered. Questions are sorted by votes, so speakers can start with the popular ones.",
  qaAnonymity: "How names are shown on questions",
  qaAnonymityHelp:
    "With “Let the asker choose”, each person decides whether to show their name when posting. Whichever you pick, organizers always see who posted, so they can deal with abuse.",
  qaAnonymityReal: "Real names only",
  qaAnonymityAnon: "Anonymous only",
  qaAnonymityChoice: "Let the asker choose",

  createSubmit: "Create",
  createError: "Could not create the event. Please check what you entered.",
  linkFailed:
    "The event was created, but it could not be linked to the idea it came from.",
  linkSkip: "Go to the event without linking",
  linkRetry: "Try linking again",

  saveError: "Could not save.",
  duplicateHeading: "Duplicate this event",
  duplicateButton: "Duplicate",
  duplicateHelp:
    "Creates a new draft with the title, description, slots, scoring criteria, awards and image copied over.",
  duplicateConfirm:
    "Duplicate this event? Participants, entries, comments and photos are not copied.",
  duplicateError: "Could not duplicate the event.",
  dangerZone: "Danger zone",
  deleteButton: "Delete this event",
  deleteConfirm:
    "Really delete it? Participants, scores and images go with it.",
  deleteAbort: "Keep it",
  deleteSubmit: "Delete",

  slotsHeading: "Slots",
  slotsEditorHeading: "Slots (capacity, first-come or lottery)",
  manageApplicants: "Manage applicants",
  slotsEmpty:
    "No slots yet. Add one with the “Add” button below — without slots, anyone can join and there is no capacity limit.",
  slotName: "Slot name",
  slotCapacity: "Capacity",
  slotSelection: "How people get in",
  slotTypeFirstCome: "First come",
  slotTypeLottery: "Lottery",
  slotConfirmedOfCapacity: "Confirmed {{n}}/{{total}}",
  slotConfirmedCapacity: "Confirmed {{n}} / capacity {{total}}",
  slotAppliedCount: "Lottery entries {{n}}",
  slotWaitlistCount: "Waitlist {{n}}",
  slotDrawAt: "Draw time (optional)",
  slotDrawAtLabel: "Draw time: {{date}}",
  slotDraw: "Draw now ({{n}} entries → {{total}} seats)",
  slotAddHeading: "Add a slot",
  slotAdd: "Add",
  slotJoin: "Join",
  slotJoinLottery: "Enter the lottery",
  slotJoinWaitlist: "Join the waitlist",

  surveyHeading: "Registration survey",
  surveyHelp:
    "Questions people answer when they register — a full name and company for building access, for example. Anyone who skips a required question cannot register. Only organizers can read the answers.",
  surveyAnswersExist:
    "Answers have already come in. New questions, and questions you make required, apply only to people who register from now on. You can see who has not answered in the answer list under Traffic.",
  surveyQuestion: "Question",
  surveyQtype: "Answer type",
  surveyOptions: "Choices (comma separated)",
  surveyOptionsExample: "For example: Yes, No",
  surveyRequired: "Required (cannot register without answering)",
  qtypeText: "Free text",
  qtypeSelect: "Pick one",
  qtypeCheckbox: "Pick any",
  surveyQuestionRequired: "Please enter the question",
  surveyOptionsRequired: "Enter at least one choice, separated by commas",
  surveyDeleteQuestion: "Delete this question",
  surveyDeleteConfirm:
    "Delete this question? Once you save, the answers it collected go with it.",
  surveyTemplateConfirm:
    "Replace the current questions with this template? Once you save, the answers to the existing questions are gone.",
  surveyLoseAnswer: "This change deletes {{n}} answer. Continue?",
  surveyLoseAnswers: "This change deletes {{n}} answers. Continue?",
  surveySaveError: "Could not save the survey.",
  surveySaved: "Survey saved.",
  surveyAddQuestion: "Add a question",
  surveyFromTemplate: "Start from a template",
  surveySave: "Save the survey",

  surveyAnswerNotice: "Only the organizers of this event can read your answers.",
  surveySelectRequired: "Please choose one",
  surveyCheckRequired: "Please choose at least one",
  surveyInputRequired: "Please fill this in",
  surveySubmitError: "Could not send your answers.",

  imageHeading: "Event image (social preview, {{width}}×{{height}})",
  imageHeadingOptional:
    "Event image (social preview, {{width}}×{{height}}, optional)",
  imageModeUpload: "Upload",
  imageModeTemplate: "Use a template",
  imageSelect: "Choose an image",
  imageAdd: "Add an image",
  imageChange: "Change the image",
  imageRemove: "Remove",
  imageNone: "No image yet",
  imageUploadError: "Upload failed. Images must be 1MB or smaller.",
  imageSchedulingSubtitle: "Date to be decided",

  imageShuffle: "Surprise me",
  imageFont: "Font",
  imageFontGothic: "Sans serif",
  imageFontRounded: "Rounded",
  imageFontMincho: "Serif",
  imageFontDisplay: "Handwritten & display",
  imageBackground: "Background",
  imageLayout: "Layout",
  imageLayoutCenter: "Centered",
  imageLayoutLeft: "Left",
  imageLayoutTop: "Top",
  imageTitleSize: "Text size",
  imageShowDate: "Show the date",
  imageHideDate: "Hide the date",
  imageUse: "Use this image",

  cropTitle: "Choose the crop",
  cropZoom: "Zoom",
  cropApply: "Apply",

  markdownEdit: "Write",
  markdownPreview: "Preview",
  markdownEmptyPreview: "Nothing to preview yet.",

  materialOpen: "Open the slides for {{title}}",
  materialUrlTitle: "Slides URL",
  materialUrlLabel: "Slides URL (Speaker Deck, Google Slides, and so on)",
  materialUrlInvalid: "Enter a URL that starts with http:// or https://",
  materialUrlHelp: "Leave it empty to remove the link",
  materialSaveError: "Could not save the slides URL.",
};

export const eventForm = { ja, en };
