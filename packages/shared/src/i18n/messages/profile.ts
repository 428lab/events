/**
 * 利用者ページの文言 (#357)。
 *
 * 対象はプロフィール本体・フォロー中の一覧・参加履歴（一覧と年表）・
 * プロフィールカードの説明・交流用QR。
 *
 * ここに置かないもの:
 * - イベント内での立場（スタッフ・審査員・観覧者）は `role.*`（labels.ts）が持つ。
 *   年表の「関わり方」も同じ立場を指すので再利用する。ここが足すのは年表だけの
 *   言い方（主催 / 登壇）だけ
 * - 「日程調整中」は `events.schedulingBadge`、「読み込み中…」「閉じる」は `common.*`
 * - 「設定」は `nav.settings`
 *
 * コミュニティでの立場のコード別ラベル表は `communityRole` として別に輸出する
 * （サーバーが返すコードで引くため）。
 */
const ja = {
  /** プロフィールが引けなかったとき */
  notFound: "ユーザーが見つかりません。",

  /** 見出し（件数つき） */
  awardsHeading: "受賞歴（{{n}}）",
  /** 受賞歴で、登壇名がプロフィール名と違うときだけイベント名に添える。
   * 括弧も、前に空白が要るかどうかも言語で変わるので画面側では書かない */
  badgesHeading: "バッジ（{{n}}）",
  photosHeading: "投稿した写真（{{n}}）",
  communitiesHeading: "所属コミュニティ",
  /** コミュニティ名に立場を添えるとき。区切りは言語で変わる */
  communityWithRole: "{{name}}・{{role}}",

  /** 参加実績。チップは1つずつ独立して出る（0件のものは出さない） */
  participationHeading: "参加実績",
  attendanceRate: "参加率 {{n}}%",
  hostedCount: "主催 {{n}}",
  staffedCount: "スタッフ {{n}}",
  spokenCount: "登壇 {{n}}",
  likesCount: "いいね {{n}}",
  participationBreakdown:
    "出席 {{attended}} ・無断欠席 {{noShow}} ・キャンセル {{canceled}}（うち直前 {{late}}）",

  /** 通算バー。数字の下に添える見出しは絞り込みに追随しないことを「通算」で示す */
  totalsLabel: "通算",
  totalEvents: "イベント",
  totalMet: "出会った人",

  /** 上部のボタン */
  follow: "フォローする",
  /** フォロー済みのボタン。フォロー中の一覧の行ボタンと見出しも同じ言い方をする */
  following: "フォロー中",
  editCard: "デザインを変える",
  showQr: "QRを見せる",

  /** 登録日とフォローの数。区切りの「 ・ 」は画面側が持つ（語順が言語で変わるため） */
  joinedOn: "{{date}} に登録",
  followerCount: "フォロワー {{n}}",
  followingCount: "フォロー中 {{n}}",

  /** 参加履歴が1件も無いとき（本人と他人で言い分ける） */
  noOngoingEvents: "参加中のイベントはありません。",
  noPublicEvents: "公開イベントの実績はまだありません。",

  /** フォロー中の一覧 */
  followingHeading: "フォロー中（{{n}}）",
  noFollowing:
    "まだ誰もフォローしていません。気になる人のプロフィールからフォローしてみましょう。",

  /** プロフィールのタブ (#407)。イベント系タブの見出しには sectionCount で
   * 件数を添える。メディアだけ開くまで取得しないので件数を添えない */
  tabUpcoming: "参加予定",
  tabPast: "参加した過去イベント",
  tabHosted: "主催したイベント",
  tabDrafts: "下書き",
  tabMedia: "投稿したメディア",
  /** タブの中身が空のとき */
  tabEmptyUpcoming: "参加予定のイベントはまだありません。",
  tabEmptyPast: "参加した過去イベントはまだありません。",
  tabEmptyHosted: "主催・運営したイベントはまだありません。",
  tabEmptyMedia: "投稿したメディアはまだありません。",

  /** メディアタブの絞り込み (#407)。期間は写真の投稿日に対して効く */
  mediaFilterEvent: "イベント",
  mediaFilterCommunity: "コミュニティ",
  mediaFilterAll: "すべて",
  mediaFilterCommented: "コメントありのみ",
  mediaFilterFrom: "投稿日（以降）",
  mediaFilterTo: "投稿日（まで）",
  mediaFilterClear: "条件をクリア",
  /** 絞り込んで1件も無いとき（未投稿の tabEmptyMedia とは区別する） */
  mediaFilterNoMatch: "条件に一致するメディアはありません。",

  /** 参加履歴（一覧と年表の切り替え） */
  historyViewToggle: "参加履歴の表示切替",
  tabList: "一覧",
  tabTimeline: "年表",
  /** まとまりの見出しに件数を添える形 */
  sectionCount: "{{title}}（{{n}}）",
  sectionDrafts: "下書きのイベント",
  sectionDraftsNote: "まだ公開していません。あなたと運営だけが見られます。",
  sectionHosting: "主催・運営するイベント",
  sectionJoining: "参加予定のイベント",
  sectionHosted: "主催・運営したイベント",
  sectionJoined: "参加したイベント",

  /** 年表。絞り込みは持たない（タブが区分・時期の軸を持つ #407） */
  timelineHeading: "参加履歴の年表",
  timelineSummary: "表示中 {{n}} 件 ・ 出会いの記録 {{m}} 件",
  metCount: "出会った {{n}} 人",

  /** 区分の2つ（主催・運営／参加）は通算バーの見出しと年表のチップに使う
   * （同じことを指すので言い方を分けない） */
  filterHost: "主催・運営",
  filterJoin: "参加",
  /** 「これから」は年表のカードのチップに使う */
  filterUpcoming: "これから",

  /** 年表だけの関わり方。スタッフ・審査員・観覧者は role.* が持つ */
  roleHost: "主催",
  roleSpeaker: "登壇",

  /** 公開写真のサムネイルと拡大表示 */
  photoStrip: "公開写真",
  photoOpen: "写真{{n}}枚目を拡大表示",
  photoMore: "ほか{{n}}枚",
  photoLightbox: "写真の拡大表示",
  photoPrev: "前の写真",
  photoNext: "次の写真",
  /** 写真からイベント詳細への導線 */
  viewEvent: "{{title}} を見る →",

  /** カードは SVG で、中に描いた文字は支援技術から読めない。絵全体に付ける名前 */
  cardAriaLabel: "{{name}} のプロフィールカード",

  /** プロフィールカードの説明（本人向け／他人向け） */
  cardOwnHint:
    "あなたのプロフィールカード。印刷（91×55mm）や画像の書き出しは「デザインを変える」から",
  cardOtherHint: "このカードは本人が選んだ見た目で表示しています",

  /** 交流用の大きなQR */
  qrLabel: "{{name}} の交流用QRコード",
  qrError:
    "QRを表示できませんでした。通信状況を確かめて、閉じてもう一度お試しください",
  qrPreparing: "QRを準備しています…",
  qrJustRead: "読み取られました。次の人もどうぞ",
  qrHint: "読み取るとその場で交流が記録されます",
} as const;

const en: Record<keyof typeof ja, string> = {
  notFound: "This user could not be found.",

  awardsHeading: "Awards ({{n}})",
  badgesHeading: "Badges ({{n}})",
  photosHeading: "Photos ({{n}})",
  communitiesHeading: "Communities",
  communityWithRole: "{{name}} · {{role}}",

  participationHeading: "Track record",
  attendanceRate: "{{n}}% attendance",
  hostedCount: "Hosted {{n}}",
  staffedCount: "Organizer {{n}}",
  spokenCount: "Talks {{n}}",
  likesCount: "Likes {{n}}",
  participationBreakdown:
    "Attended {{attended}} · No-show {{noShow}} · Cancelled {{canceled}} ({{late}} at short notice)",

  totalsLabel: "All time",
  totalEvents: "Events",
  totalMet: "People met",

  follow: "Follow",
  following: "Following",
  editCard: "Change the design",
  showQr: "Show my QR",

  joinedOn: "Joined {{date}}",
  followerCount: "{{n}} followers",
  followingCount: "{{n}} following",

  noOngoingEvents: "No events at the moment.",
  noPublicEvents: "No public events yet.",

  followingHeading: "Following ({{n}})",
  noFollowing:
    "You aren't following anyone yet. Open someone's profile to follow them.",

  tabUpcoming: "Upcoming",
  tabPast: "Past events attended",
  tabHosted: "Events organized",
  tabDrafts: "Drafts",
  tabMedia: "Media",
  tabEmptyUpcoming: "No upcoming events yet.",
  tabEmptyPast: "No past events yet.",
  tabEmptyHosted: "No organized events yet.",
  tabEmptyMedia: "No media posted yet.",

  mediaFilterEvent: "Event",
  mediaFilterCommunity: "Community",
  mediaFilterAll: "All",
  mediaFilterCommented: "With comments only",
  mediaFilterFrom: "Posted on or after",
  mediaFilterTo: "Posted on or before",
  mediaFilterClear: "Clear filters",
  mediaFilterNoMatch: "No media match the filters.",

  historyViewToggle: "Switch how the history is shown",
  tabList: "List",
  tabTimeline: "Timeline",
  sectionCount: "{{title}} ({{n}})",
  sectionDrafts: "Draft events",
  sectionDraftsNote: "Not published yet. Only you and the organizers can see it.",
  sectionHosting: "Events you're organizing",
  sectionJoining: "Events you're attending",
  sectionHosted: "Events you organized",
  sectionJoined: "Events you attended",

  timelineHeading: "History timeline",
  timelineSummary: "Showing {{n}} · {{m}} meetings recorded",
  metCount: "Met {{n}} people",

  filterHost: "Organized",
  filterJoin: "Joined",
  filterUpcoming: "Upcoming",

  roleHost: "Host",
  roleSpeaker: "Speaker",

  photoStrip: "Public photos",
  photoOpen: "Enlarge photo {{n}}",
  photoMore: "{{n}} more",
  photoLightbox: "Enlarged photo",
  photoPrev: "Previous photo",
  photoNext: "Next photo",
  viewEvent: "Open {{title}} →",

  cardAriaLabel: "{{name}}'s profile card",

  cardOwnHint:
    "Your profile card. Printing (91×55mm) and image export are under “Change the design”.",
  cardOtherHint: "This card is shown with the look its owner chose.",

  qrLabel: "{{name}}'s meet-up QR code",
  qrError:
    "Couldn't show the QR code. Check your connection, then close this and try again.",
  qrPreparing: "Preparing the QR code…",
  qrJustRead: "Scanned. Next person, go ahead",
  qrHint: "Scanning records your meeting on the spot",
};

export const profile = { ja, en };

/**
 * コミュニティでの立場 (#357)。サーバーが返すコードで引く。
 *
 * 一般メンバー (`member`) はプロフィールでラベルを添えないので、ここには
 * 置かない（どの立場に添えるかの判定は画面側が持つ）。
 */
const communityRoleJa = {
  owner: "オーナー",
  admin: "管理者",
} as const;

const communityRoleEn: Record<keyof typeof communityRoleJa, string> = {
  owner: "Owner",
  admin: "Admin",
};

export const communityRole = { ja: communityRoleJa, en: communityRoleEn };
