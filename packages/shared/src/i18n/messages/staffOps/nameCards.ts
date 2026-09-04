/** 名札の印刷 (#304) とアクセス統計 (#152 / #154)。 */
const ja = {
  /* ── 名札の印刷 (#304)。見出しは eventDetail.nameCards ──────── */
  nameCardStaffOnly: "この画面はイベントのスタッフだけが使えます。",
  nameCardLoadFailed: "名札の情報を取得できませんでした。",
  nameCardIntro:
    "A4に10面（91×55mm）で並べます。市販の名刺用紙や名札ケースに合う大きさです",
  nameCardNoMembers: "参加が確定しているメンバーがまだいません。",
  nameCardCountOneSheet: "{{selected}} 人 / {{all}} 人（A4 {{sheets}} 枚）",
  nameCardCount: "{{selected}} 人 / {{all}} 人（A4 {{sheets}} 枚）",
  nameCardSelectAll: "すべて選ぶ",
  nameCardClearAll: "すべて外す",
  nameCardPrint: "印刷する",
  nameCardBuilding: "カードを作成しています（{{done}} / {{total}}）",
  nameCardPeopleHeading: "印刷する人",
  nameCardPrintCheckbox: "{{name}} を印刷する",
  nameCardPreviewHeading: "刷り上がりのプレビュー",
  nameCardPreviewNote:
    "背景の色を出すには、印刷ダイアログで「背景のグラフィック」を有効にしてください",

  /* ── アクセス統計 (#152 / #154)。見出しは eventDetail.stats ──── */
  statsStaffOnly: "アクセス統計はスタッフ専用です。",
  statsLoadFailed: "統計を取得できませんでした。",
  statsRange7: "7日",
  statsRange30: "30日",
  statsRangeAll: "全期間",
  statsViews: "表示回数 (PV)",
  statsUniques: "ユニークビジター",
  statsJoins: "参加登録数",
  statsEmpty:
    "まだアクセスがありません。公開してシェアすると、ここに流入元や推移が表示されます。",
  statsSources: "流入元",
  statsCountries: "国・地域",
  statsDaily: "日別の推移",
  statsLegendJoins: "参加登録",
  statsDayTooltip:
    "{{day}}  PV:{{views}} / ユニーク:{{uniques}} / 参加:{{joins}}",
  statsNoData: "データなし",
  /** 流入元のうち、サイトが自分で付ける印。外部サイトの名前（X・Facebook 等）は
   *  どの言語でも同じ綴りなので画面側の表に残してある */
  sourceDirect: "直接アクセス",
  sourceInternal: "サイト内",
  sourceNotification: "通知",
  sourceFeed: "フィード",
  sourceEmail: "メール",
  sourceCard: "カード",
  /** 事前アンケートの回答一覧 */
  surveyTitle: "アンケート回答",
  surveyRemind: "未回答者にお願い通知",
  surveyRemindConfirm:
    "未回答の確定参加者に「アンケート回答のお願い」通知を送りますか？",
  surveyRemindedOne: "{{n}} 人に通知しました",
  surveyReminded: "{{n}} 人に通知しました",
  surveyRemindFailed: "送信に失敗しました",
  surveyCsv: "CSVダウンロード",
  surveyNote: "参加登録時のアンケート回答です（スタッフのみ閲覧できます）。",
  surveyEmpty: "まだ回答がありません。",
  surveyStatusColumn: "参加状態",
  /** 参加状態の残り1つ。確定・キャンセル待ち・抽選申込中・落選は
   *  eventDetail.status* と同じ文言なのでそちらを引く */
  surveyStatusCanceled: "キャンセル",
  surveyNotJoined: "未参加",
  /** 出会い数ランキング */
  meetRankingTitle: "出会いランキング",
  meetRankingNote:
    "「出会った！」の記録数です。参加者向けランキングの設定に依らず、スタッフはここで全順位を名前入りで見られます。景品の参考にどうぞ。",
} as const;

const en: Record<keyof typeof ja, string> = {
  nameCardStaffOnly: "This page is only for the organizers of this event.",
  nameCardLoadFailed: "Could not load the name card data.",
  nameCardIntro:
    "Ten cards per A4 sheet (91 × 55 mm), sized to fit off-the-shelf business card stock and badge holders",
  nameCardNoMembers: "Nobody has a confirmed registration yet.",
  nameCardCountOneSheet: "{{selected}} of {{all}} people ({{sheets}} A4 sheet)",
  nameCardCount: "{{selected}} of {{all}} people ({{sheets}} A4 sheets)",
  nameCardSelectAll: "Select everyone",
  nameCardClearAll: "Clear all",
  nameCardPrint: "Print",
  nameCardBuilding: "Building the cards ({{done}} / {{total}})",
  nameCardPeopleHeading: "Who to print",
  nameCardPrintCheckbox: "Print {{name}}",
  nameCardPreviewHeading: "Print preview",
  nameCardPreviewNote:
    "To print the background colours, turn on “Background graphics” in the print dialog.",

  statsStaffOnly: "Traffic stats are for organizers only.",
  statsLoadFailed: "Could not load the stats.",
  statsRange7: "7 days",
  statsRange30: "30 days",
  statsRangeAll: "All time",
  statsViews: "Page views",
  statsUniques: "Unique visitors",
  statsJoins: "Registrations",
  statsEmpty:
    "No visits yet. Once you publish this event and share it, you will see where people come from and how traffic changes over time.",
  statsSources: "Where people come from",
  statsCountries: "Countries and regions",
  statsDaily: "Day by day",
  statsLegendJoins: "Sign-ups",
  statsDayTooltip:
    "{{day}}  views: {{views}} / unique: {{uniques}} / sign-ups: {{joins}}",
  statsNoData: "No data",
  sourceDirect: "Direct",
  sourceInternal: "Within the site",
  sourceNotification: "Notification",
  sourceFeed: "Feed",
  sourceEmail: "Email",
  sourceCard: "Profile card",
  surveyTitle: "Survey answers",
  surveyRemind: "Remind people who have not answered",
  surveyRemindConfirm:
    "Send a “please answer the survey” notification to confirmed participants who have not answered yet?",
  surveyRemindedOne: "Notified {{n}} person",
  surveyReminded: "Notified {{n}} people",
  surveyRemindFailed: "Could not send the notifications.",
  surveyCsv: "Download CSV",
  surveyNote:
    "The answers people gave when they registered (organizers only).",
  surveyEmpty: "No answers yet.",
  surveyStatusColumn: "Status",
  surveyStatusCanceled: "Canceled",
  surveyNotJoined: "Not registered",
  meetRankingTitle: "Meet ranking",
  meetRankingNote:
    "How many meets each person recorded. Organizers always see every rank with names here, whatever the participant-facing ranking setting is. Handy when handing out prizes.",
};

export const nameCards = { ja, en };
