/**
 * KPI の共有部品と、コミュニティKPI 画面の文言 (#376)。
 *
 * ここに置かないもの:
 * - **管理ダッシュボードのページ本体**（`AdminKpiPage` / `AdminTrendingPage` /
 *   `AdminAbusePage`）は i18n の対象外。共有部品を通る部分だけがここを引くので、
 *   英語表示にすると管理画面は「枠が日本語・部品が英語」になる。見るのは運営だけ
 *   なので許容する、という決定 (#352)
 * - 「読み込み中…」は `common.loading`、「コミュニティが見つかりません。」は
 *   `community.notFound`。書き写さない
 * - コミュニティ詳細から来る導線の「数字を見る」は `community.kpi`。
 *   こちらの `heading` は開いた先の見出しなので別物
 * - 参加回数の分布の区間名（「1回」「4〜5回」など）は**サーバーが組み立てて返す**
 *   ので、ここでは訳せない（サーバーが出す文言の段階でまとめて扱う）
 *
 * 数の入れ替えは {{n}} を使う（`count` は i18next の複数形の仕組みを起動するため）。
 * 数と一緒に出す名詞は、英語で「1 events」にならないよう**数のあとに名詞を
 * 置かない書き方**にしてある（「Events held: 1 ÷ 3」の形）。例外は横棒グラフの
 * 単位で、そこだけ単数用のキー (`unitPerson`) を用意して画面が数で選ぶ。
 */
const ja = {
  /* ---------------- 共有部品 (KpiTiles / KpiNote / InfoTip) ---------------- */

  /** ⓘボタンの読み上げ名。{{label}} は見出しやタイル名 */
  infoTip: "{{label}}の説明",
  /** 数字の読み方を畳んでいる1行 (KpiNote の既定) */
  noteSummary: "数字の読み方",
  /** 出すものが無いとき。グラフと横棒グラフで同じ言い方をする */
  noData: "データなし",

  /** 前期間比 (#266)。増減そのものは記号（▲▼±）なので辞書に置かない */
  previousPeriod: "前期間 {{value}}",
  /** 前期間が無い（この期間に初めて出た）とき */
  trendNew: "新規",

  /** 推移グラフの見出し。日別・週別・月別は畳んだ粒度 */
  chartTitle: "{{title}}（{{granularity}}）",
  granularityDay: "日別",
  granularityWeek: "週別",
  granularityMonth: "月別",
  /** 週次・月次に畳んだときの断り */
  chartWeekNote:
    "月曜始まりの週ごとの集計です。期間の端にある欠けた週は出していません。",
  chartMonthNote:
    "暦月ごとの集計です。期間の端にある欠けた月は出していません。",
  /** 計測開始が期間の途中のとき。「0が続いている」に見えないようにする (#292) */
  chartMeasuredFrom:
    "{{day}}から計測しています。それより前は棒を出していません（0ではなく、計測していません）。",
  /** 選んだ期間が丸ごと計測開始より前 */
  chartMeasuredFromEmpty:
    "{{day}}から計測しています。選んだ期間には計測したデータがまだありません。",
  /** 一度も計測していない */
  chartNeverMeasured: "この期間に計測したデータはありません。",
  /** 日次には値があるのに、畳んだら端の欠けたバケツしか残らなかった */
  chartPartialWeek:
    "計測できているのは期間の一部だけで、まるまる1週間そろった週がまだありません。短い期間を選ぶと日別で見られます。",
  chartPartialMonth:
    "計測できているのは期間の一部だけで、まるまる1か月そろった月がまだありません。短い期間を選ぶと日別で見られます。",
  /** ホバーで出す期間。日別は日付そのもの、月別は Intl が組み立てる */
  barPeriodWeek: "{{day}} の週",
  /** グラフの下の単位 */
  chartUnit: "単位: {{unit}}",

  /** 横棒グラフの値と単位。**英語だけ半角スペースが入る**ので辞書が持つ */
  valueWithUnit: "{{value}}{{unit}}",
  /** 単位の語。日本語はどちらも同じ綴りで、英語だけ単複が変わる */
  unitPerson: "人",
  unitPeople: "人",
  unitEvents: "件",

  /* ---------------- コミュニティKPI (#262) ---------------- */

  heading: "コミュニティの数字",
  noPermission: "このページはコミュニティの管理者だけが見られます。",
  loadError: "数字の取得に失敗しました。時間をおいて再読み込みしてください。",
  /** 画面の頭に畳んである読み方。{{all}} には期間ボタンの「全期間」が入る */
  communityNote:
    "コミュニティの状態を振り返るための数字です。良し悪しを採点するものではなく、「次に何を試すか」を考えるための材料として使ってください。数え方は運営ダッシュボードの全体KPIと揃えてあり、主催・スタッフの行（イベント作成時に自動で作られます）と退会申請中のユーザーは除いています。審査員・観覧者は実際にイベントに来る人なので参加者として数えます。母数が少ないときは率が極端に振れて誤読しやすいため、件数だけを出して率は「—」にしています。数字の下の「前期間」は同じ長さのひとつ前の期間との比較で、減ったほうが良い指標（参加者が少なかった回の割合・キャンセル率・しばらく参加していない人の割合など）は下がったときを緑にしています。{{all}}を選ぶと比べる過去が無いため出しません。",

  /** 期間の切り替え。React の key は日数から作るので、ここは文言だけ */
  range30: "30日",
  range90: "90日",
  range365: "1年",
  rangeAll: "全期間",

  /** 母数不足の補足。足りていない母数を並べて出す */
  fewItem: "{{label}}が {{n}}",
  fewSeparator: "、",
  fewCaution: "{{list}}のため、このセクションの割合は「—」にしています",
  fewDetail:
    "いまは{{list}}のため、このセクションの割合は「—」にしています（{{n}} 以上で表示。少ない母数だと1件・1人の増減で割合が大きく動くためです）。件数と平均はそのまま出しています。",
  /** 母数として並べるものの呼び名。タイルのラベルと綴りが同じものは
   *  `label*` を使い回す（同じ日本語を2つのキーに割らない） */
  baseDudEvents: "参加者数を判定できた開催数",
  baseHeldEvents: "開催数",
  baseFollowers: "フォロー人数",

  /** 減ったほうが良い指標に共通で付く一文。5つのヒントの末尾に足す。
   *  **英語は前に半角スペースが入る**（`common.parenName` と同じ扱い）。
   *  足す側のキーの末尾に空白を置くと編集ツールに落とされるので、こちらが持つ */
  lowerIsBetter: "減ったほうが良い指標なので、下がったときを緑にしています",

  /* 開催と参加 */
  nsTitle: "開催と参加",
  nsNote:
    "このコミュニティに紐づく公開イベントのうち、期間内に終了したものが対象です。出席チェックを実施したイベントは出席者数、未実施は確定登録者数を数えます（イベントページの参加者数と同じ定義なので主催・スタッフを含みます）。何が分かるか: 活動の量と、1回あたりの集まり具合。",
  labelParticipations: "参加体験の数",
  hintParticipations:
    "開催済みイベントの参加者の合計（主催・スタッフを含む）。主催・スタッフを除くと {{n}}",
  labelHeldEvents: "開催イベント数",
  hintHeldEvents: "期間内に終了した公開イベント（日程確定済み・開催日設定済み）",
  labelAvgParticipants: "1イベントあたり平均参加者",
  /** 割り算の式。タイルのラベルを2つ差し込む（同じ文言を2か所に置かない） */
  hintDivide: "{{a}} ÷ {{b}}",
  labelDudRate: "参加者が少なかった回の割合",
  hintDudRate:
    "参加者3人以下 {{a}} 件 ÷ {{b}} 件。出席チェックを有効にしたのに記録が0件の {{c}} 件は判定できないため除いています。告知のタイミングや開催形式を見直すヒントに。",
  chartParticipationsTitle: "参加体験の推移",
  chartParticipationsHint:
    "イベントが終了した日に立てています。主催・スタッフを含む合計です。",
  chartHeldEventsTitle: "開催の推移",
  chartHeldEventsHint:
    "イベントが終了した日に立てています。{{label}}とは桁が違うため、別のグラフにしています。",

  /* 新規流入と常連 */
  labelRepeatRate: "また来てくれた人の割合",
  hintRepeatRate: "期間内に2回以上参加 {{a}} 人 ÷ 参加した人数 {{b}} 人",
  ncAllTitle: "また来てくれた人",
  ncAllNote:
    "全期間では「期間より前に参加していたか」を判定できない（比べる過去が無い）ため、初参加と常連の内訳は出していません。新規流入を見たいときは {{a}}・{{b}}・{{c}}に切り替えてください。",
  labelParticipants: "参加した人数",
  hintParticipantsAll:
    "このコミュニティのイベントに参加したことがある実人数（全期間）",
  ncTitle: "新規流入と常連",
  ncNote:
    "期間内にこのコミュニティのイベントに参加した人を、「初参加」と「以前にも来ていた人」に分けています。初参加の判定は、期間の開始日より前に終了したこのコミュニティの公開イベントへの参加記録が無いこと。何が分かるか: 常連だけで回っていないか、新しい人が入る余地があるか。",
  labelNewcomerRate: "初参加の割合",
  hintNewcomerRate: "初参加 {{a}} 人 ÷ 参加した人数 {{b}} 人",
  labelNewcomers: "初参加の人数",
  hintNewcomers: "このコミュニティのイベントに初めて来た人",
  labelRegulars: "以前にも来ていた人数",
  hintRegulars:
    "期間より前にも参加していた人。ここが厚いほど継続的な関係ができています",

  /* 開催を担っている人 */
  hostTitle: "開催を担っている人",
  hostNote:
    "期間内にこのコミュニティのイベントを開いた人の内訳です（退会申請中の人は除きます）。何が分かるか: 開催が特定の人に集中していないか。集中していても問題があるとは限りませんが、その人が忙しくなると活動が止まりやすくなります。",
  labelHosts: "開催した人数",
  hintHosts: "期間内に1件以上イベントを開いた実人数",
  labelTopHostShare: "いちばん多い人のシェア",
  hintTopHostShare:
    "最多の1人が {{a}} 件 ÷ 開催 {{b}} 件。高いときは共同開催や当番制を試すヒントに。特定の人への集中は下がったほうが良いので、下がったときを緑にしています",
  labelAvgEventsPerHost: "1人あたり開催数",
  hintAvgEventsPerHost: "開催 {{a}} 件 ÷ 開催した人数 {{b}} 人",
  labelRepeatHostRate: "2回以上開いた人の割合",
  hintRepeatHostRate: "2回以上 {{a}} 人 ÷ 開催した人数 {{b}} 人",

  /* フォローしている人の動き */
  dormantTitle: "フォローしている人の動き",
  dormantNote:
    "フォロー登録（コミュニティのメンバー）をしている在籍ユーザーのうち、期間内に開催されたイベントに参加した人と、していない人の内訳です。イベントに参加しただけでフォローしていない人は含みません。主催のみの人は「参加」に数えません。抽選や先着で参加枠を絞っている場合、申し込んだけれど参加できなかった人も「参加していない人」に入るため、実際より高く見えます。何が分かるか: 名簿だけが増えていないか、届いていない人にどう声をかけるか。",
  labelDormantRate: "しばらく参加していない人の割合",
  hintDormantRate: "未参加 {{a}} 人 ÷ フォロー {{b}} 人。",
  labelFollowers: "フォローしている人数",
  hintFollowers:
    "コミュニティをフォローしている在籍ユーザー（コミュニティページのメンバー数はイベント参加者も含むため一致しません）。いまの人数のスナップショットなので、前期間比は出しません",
  labelActiveMembers: "うち期間内に参加した人数",
  hintActiveMembers:
    "期間内に開催されたこのコミュニティのイベントに参加した人",

  /* 他のコミュニティとの重なり */
  overlapTitle: "他のコミュニティとの重なり",
  overlapNote:
    "期間内にこのコミュニティのイベントに参加した人が、他のどのコミュニティの公開イベントにも参加しているか（時期は問いません・多い順に最大5件）。誰でも見られる公開イベントの参加記録だけを使っています。数え方は分子と分母で少し違い、こちら側（分母）は出席チェックを反映した期間内の参加、相手側（分子）は公開イベントへの確定登録で、出席チェックと時期は問いません。重なっている人が {{n}} 人未満のコミュニティは、メンバー一覧と突き合わせると誰のことか分かってしまうため出していません。何が分かるか: 声をかけやすい連携先、独自の層をどれくらい持てているか。",
  overlapBarsTitle: "重なっている人数（参加者 {{n}} 人中）",
  overlapBarsHint:
    "期間内にこのコミュニティのイベントに参加した人のうち、他のコミュニティの公開イベントにも参加している人数",
  overlapEmpty:
    "他のコミュニティのイベントに参加している人は見つかりませんでした（重なりが {{n}} 人未満のコミュニティは出していません）。",
  /** 相手コミュニティのタイル。{{n}} は母数ゲートより小さくならないので単数用は作らない */
  overlapTileHint: "{{n}} 人が重なっています（@{{slug}}）",

  /* 参加者の動き（詳細） */
  pTitle: "参加者の動き（詳細）",
  pNote: "登録・キャンセルは「登録が作成された日」、出席は「イベントが終了した日」で期間を切っています。キャンセルは、取り消したあと同じイベントに再参加すると記録が上書きされるため少なめに出ます。何が分かるか: 告知から参加までのつまずき、当日来られなくなる人の傾向。",
  labelRegistrations: "参加登録数",
  hintRegistrations:
    "期間内に作成された登録（取消を含む全ステータス）。取消も含むため、増えたことが良いとは限りません",
  labelConfirmed: "うち確定",
  hintConfirmed: "いま確定状態の登録",
  labelUniqueViewers: "イベント詳細の閲覧UU",
  hintUniqueViewers:
    "このコミュニティのイベント詳細を見た訪問者（Cookieで重複排除）。総表示回数 {{n}}",
  labelViewToJoin: "閲覧→登録の転換率",
  hintViewToJoin:
    "概算です。一覧やお知らせなど詳細ページを経由しない登録も分子に入るため100%を超えることがあります。低いときはイベント説明や日時の書き方を見直すヒントに",
  labelAttendanceRate: "出席率",
  hintAttendanceRate:
    "出席 {{a}} ÷ 出席チェックを実施したイベントの確定参加者 {{b}}",
  labelNoShowRate: "当日来られなかった割合",
  hintNoShowRate:
    "登録したのに出席チェックされなかった割合。リマインドの有無を見直すヒントに。",
  labelCancelRate: "キャンセル率",
  hintCancelRate: "取消 {{a}} ÷ 期間内の登録 {{b}}（日程調整中の取消は除外）。",
  labelLateCancelRate: "うち直前24時間の割合",
  hintLateCancelRate:
    "直前24時間の取消 {{a}} ÷ 取消 {{b}}（事前の取消は {{c}} 件）。",
  labelCountDistribution: "参加回数の分布",
  hintCountDistribution: "期間内に開催されたイベントへの参加回数",
} as const;

const en: Record<keyof typeof ja, string> = {
  infoTip: "About {{label}}",
  noteSummary: "How to read these numbers",
  noData: "No data",

  previousPeriod: "Previous {{value}}",
  trendNew: "New",

  chartTitle: "{{title}} ({{granularity}})",
  granularityDay: "Daily",
  granularityWeek: "Weekly",
  granularityMonth: "Monthly",
  chartWeekNote:
    "Grouped into weeks starting on Monday. Partial weeks at either end are left out.",
  chartMonthNote:
    "Grouped into calendar months. Partial months at either end are left out.",
  chartMeasuredFrom:
    "Measurement started on {{day}}. Nothing is drawn before that (it is not zero, it was simply not measured).",
  chartMeasuredFromEmpty:
    "Measurement started on {{day}}. There is no measured data yet in the period you chose.",
  chartNeverMeasured: "Nothing was measured during this period.",
  chartPartialWeek:
    "Only part of this period has been measured, and no full week has completed yet. Choose a shorter period to see it day by day.",
  chartPartialMonth:
    "Only part of this period has been measured, and no full month has completed yet. Choose a shorter period to see it day by day.",
  barPeriodWeek: "Week of {{day}}",
  chartUnit: "Unit: {{unit}}",

  valueWithUnit: "{{value}} {{unit}}",
  unitPerson: "person",
  unitPeople: "people",
  unitEvents: "events",

  heading: "Community numbers",
  noPermission: "Only community admins can see this page.",
  loadError:
    "The numbers could not be loaded. Please wait a moment and reload the page.",
  communityNote:
    "These numbers are here to help you look back on how the community is doing. They are not a score. Use them as material for deciding what to try next. They are counted the same way as the overall KPIs on the admin dashboard: rows for the host and organizers (created automatically when an event is made) and users who have asked to close their account are left out. Judges and observers actually come to events, so they count as participants. When the base is small, a rate swings wildly and is easy to misread, so only counts are shown and the rate becomes “—”. The “Previous” line under a number compares with the immediately preceding period of the same length; metrics that are better when they go down (share of events with few participants, cancellation rate, share of followers who have not taken part for a while, and so on) are shown in green when they fall. Choosing {{all}} hides it, because there is no earlier period to compare with.",

  range30: "30 days",
  range90: "90 days",
  range365: "1 year",
  rangeAll: "All time",

  fewItem: "{{label}}: {{n}}",
  fewSeparator: ", ",
  fewCaution:
    "Rates in this section are shown as “—” because the base is small ({{list}})",
  fewDetail:
    "Rates in this section are shown as “—” because the base is small ({{list}}). They appear once the base reaches {{n}}, because with a small base one more or one fewer moves the rate a lot. Counts and averages are still shown.",
  baseDudEvents: "Events with a measurable participant count",
  baseHeldEvents: "Number of events held",
  baseFollowers: "Followers",

  lowerIsBetter:
    " This is better when it goes down, so a fall is shown in green",

  nsTitle: "Events and participation",
  nsNote:
    "Covers public events belonging to this community that ended during the period. Events with attendance check use the number who attended; the rest use the number of confirmed registrations (the same definition as the participant count on an event page, so the host and organizers are included). What this tells you: how much is happening, and how many people each event brings together.",
  labelParticipations: "Participation experiences",
  hintParticipations:
    "Total participants across events that have ended (host and organizers included). Excluding the host and organizers: {{n}}",
  labelHeldEvents: "Events held",
  hintHeldEvents:
    "Public events that ended during the period (dates fixed and set)",
  labelAvgParticipants: "Average participants per event",
  hintDivide: "{{a}} ÷ {{b}}",
  labelDudRate: "Share of events with few participants",
  hintDudRate:
    "Events with 3 or fewer participants: {{a}} ÷ {{b}}. Left out are the ones where attendance check was on but nothing was recorded ({{c}}), because they cannot be judged. A hint for revisiting when you announce events and how you run them.",
  chartParticipationsTitle: "Participation over time",
  chartParticipationsHint:
    "Plotted on the day each event ended. The total includes the host and organizers.",
  chartHeldEventsTitle: "Events held over time",
  chartHeldEventsHint:
    "Plotted on the day each event ended. Kept in a separate chart because the scale is far smaller than {{label}}.",

  labelRepeatRate: "Share who came back",
  hintRepeatRate:
    "Took part twice or more during the period: {{a}} ÷ {{b}} people who took part",
  ncAllTitle: "People who came back",
  ncAllNote:
    "Over all time there is no way to tell whether someone had taken part before the period (there is no earlier period to compare with), so the split between first-timers and returning people is not shown. To look at new arrivals, switch to {{a}}, {{b}} or {{c}}.",
  labelParticipants: "People who took part",
  hintParticipantsAll:
    "Distinct people who have ever taken part in an event of this community (all time)",
  ncTitle: "New arrivals and regulars",
  ncNote:
    "Splits the people who took part in an event of this community during the period into first-timers and people who had come before. Someone counts as a first-timer when they have no record of taking part in a public event of this community that ended before the start of the period. What this tells you: whether the community runs on regulars alone, and whether there is room for new people.",
  labelNewcomerRate: "Share of first-timers",
  hintNewcomerRate: "First-timers: {{a}} ÷ {{b}} people who took part",
  labelNewcomers: "Number of first-timers",
  hintNewcomers: "People who came to an event of this community for the first time",
  labelRegulars: "People who had come before",
  hintRegulars:
    "People who had also taken part before the period. The thicker this is, the more lasting relationships the community has",

  hostTitle: "People who host",
  hostNote:
    "A breakdown of the people who ran an event of this community during the period (people who have asked to close their account are left out). What this tells you: whether hosting rests on one person. That is not a problem in itself, but activity stalls easily when that person gets busy.",
  labelHosts: "People who hosted",
  hintHosts:
    "Distinct people who ran at least one event during the period",
  labelTopHostShare: "Share held by the busiest host",
  hintTopHostShare:
    "The busiest single person: {{a}} ÷ {{b}} events held. When this is high, co-hosting or taking turns is worth a try. Concentration on one person is better when it goes down, so a fall is shown in green",
  labelAvgEventsPerHost: "Events per host",
  hintAvgEventsPerHost: "{{a}} events held ÷ {{b}} people who hosted",
  labelRepeatHostRate: "Share who hosted twice or more",
  hintRepeatHostRate: "Hosted twice or more: {{a}} ÷ {{b}} people who hosted",

  dormantTitle: "How followers are doing",
  dormantNote:
    "A breakdown of the active users who follow this community (its members), split into those who took part in an event held during the period and those who did not. People who only took part in an event without following are not included. Hosting alone does not count as taking part. If places are limited by lottery or first-come-first-served, people who applied but could not get in also land in the second group, so this reads higher than reality. What this tells you: whether the list is growing on its own, and how to reach the people you are not reaching.",
  labelDormantRate: "Share who have not taken part for a while",
  hintDormantRate: "Did not take part: {{a}} ÷ {{b}} followers.",
  labelFollowers: "Number of followers",
  hintFollowers:
    "Active users who follow this community (the member count on the community page also includes event participants, so the two do not match). This is a snapshot of the current number, so no comparison with the previous period is shown",
  labelActiveMembers: "Of those, took part during the period",
  hintActiveMembers:
    "People who took part in an event of this community held during the period",

  overlapTitle: "Overlap with other communities",
  overlapNote:
    "Which other communities the people who took part in an event of this community during the period also take part in (at any time, top 5 by size). Only records from public events, which anyone can see, are used. The numerator and the denominator are counted slightly differently: this side (the denominator) is participation during the period with attendance check applied, while the other side (the numerator) is confirmed registration for a public event, regardless of attendance check or timing. Communities with fewer than {{n}} people in common are left out, because cross-referencing them with a member list would reveal who they are. What this tells you: who is easy to team up with, and how much of an audience of your own you have.",
  overlapBarsTitle: "People in common (out of {{n}} who took part)",
  overlapBarsHint:
    "Of the people who took part in an event of this community during the period, how many also take part in public events of another community",
  overlapEmpty:
    "No one was found who also takes part in events of another community (communities with fewer than {{n}} people in common are left out).",
  overlapTileHint: "{{n}} people in common (@{{slug}})",

  pTitle: "Participant activity in detail",
  pNote: "Registrations and cancellations are counted on the day the registration was created; attendance is counted on the day the event ended. Cancellations read low, because cancelling and then signing up for the same event again overwrites the record. What this tells you: where people stumble between hearing about an event and taking part, and who tends to drop out on the day.",
  labelRegistrations: "Registrations",
  hintRegistrations:
    "Registrations created during the period (every status, cancellations included). Since cancellations are included, a rise is not necessarily good",
  labelConfirmed: "Of those, confirmed",
  hintConfirmed: "Registrations that are confirmed right now",
  labelUniqueViewers: "Unique viewers of event pages",
  hintUniqueViewers:
    "Visitors who looked at an event page of this community (deduplicated by cookie). Total views: {{n}}",
  labelViewToJoin: "View → registration conversion",
  hintViewToJoin:
    "A rough figure. Registrations that never pass through an event page, such as those from a list or a notification, also land in the numerator, so this can go above 100%. When it is low, it is a hint to revisit how event descriptions and dates are written",
  labelAttendanceRate: "Attendance rate",
  hintAttendanceRate:
    "Attended {{a}} ÷ confirmed participants of events with attendance check {{b}}",
  labelNoShowRate: "Share who did not show up",
  hintNoShowRate:
    "Share of people who registered but were never checked in. A hint for revisiting whether reminders go out.",
  labelCancelRate: "Cancellation rate",
  hintCancelRate:
    "Cancelled {{a}} ÷ registrations during the period {{b}} (cancellations while dates are being arranged are left out).",
  labelLateCancelRate: "Of those, within the last 24 hours",
  hintLateCancelRate:
    "Cancelled within the last 24 hours {{a}} ÷ cancelled {{b}} (cancelled earlier: {{c}}).",
  labelCountDistribution: "Distribution of times taken part",
  hintCountDistribution: "How many times people took part in events held during the period",
};

export const kpi = { ja, en };
