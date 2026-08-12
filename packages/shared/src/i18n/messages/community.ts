/**
 * コミュニティの一覧・詳細・メンバー・作成/編集フォームの文言 (#366)。
 *
 * ここに置かないもの:
 * - 見出しの「コミュニティ」は `nav.communities`
 * - コミュニティでの立場（オーナー・管理者）は `communityRole`（profile.ts）。
 *   サーバーが返すコードで引くので `tDynamic` から。**どの立場にラベルを
 *   出すかの判定は画面側**（一般メンバーには出さない）
 * - 「フォロー中」（フォロー済みのボタン）は `profile.following`。
 *   プロフィールのフォローボタンと同じ状態を同じ言い方で出す
 * - 「削除」「削除する」「編集」「保存」「キャンセル」「追加」「読み込み中…」は `common.*`
 * - たまごの節（見出し・投稿導線・0件の案内）は `egg.*`
 *
 * 数の入れ替えは {{n}} を使う（`count` は i18next の複数形の仕組みを起動するため）。
 */
const ja = {
  /** 一覧が引けなかったとき。メンバー一覧からも引く */
  notFound: "コミュニティが見つかりません。",
  /** 一覧の 0 件 */
  empty: "まだコミュニティがありません。",
  /** 作る導線。一覧のボタンと作成ページの見出しで同じ綴り */
  create: "コミュニティを作る",

  /** 一覧・詳細の meta 行。項目の区切りは `common.dotSeparator` を画面が挟む。
   *  英語は数が先に来るので、`profile.likesCount`（"Likes {{n}}" の実績チップ）
   *  とは並べ方が違う。同じ日本語でも別の形なので分けている */
  memberCountOne: "メンバー {{n}}",
  memberCount: "メンバー {{n}}",
  eventCountOne: "イベント {{n}}",
  eventCount: "イベント {{n}}",
  likeCountOne: "いいね {{n}}",
  likeCount: "いいね {{n}}",

  /** 詳細のボタン */
  kpi: "数字を見る",
  follow: "フォロー",

  /** 削除の確認 */
  deleteTitle: "コミュニティを削除しますか？",
  deleteBody:
    "「{{name}}」を削除します。所属イベントは無所属に戻ります（イベント自体は削除されません）。この操作は取り消せません。",

  /** メンバー一覧 */
  membersHeading: "メンバー（{{n}}）",
  membersEmpty: "メンバーはいません。",
  makeAdmin: "管理者にする",
  makeMember: "メンバーに戻す",
  transferOwner: "オーナー譲渡",
  transferConfirm:
    "{{name}} にオーナーを譲渡します。あなたは管理者になります。よろしいですか？",

  /** 作成フォーム */
  slugLabel: "コミュニティID（URLに使います）",
  slugHelp: "3〜32文字の半角英小文字・数字・ハイフン（先頭末尾は英数字）",
  slugPreview: "公開URL: /c/{{slug}}",
  nameLabel: "コミュニティ名",
  descriptionLabel: "説明",
  markdownHelp: "Markdown が使えます",
  createSubmit: "作成する",
  /** 作成の失敗。画面は**コードだけを state に持ち**、描画時にここを引く */
  createErrorTaken: "このIDは既に使われています",
  createErrorReserved: "このIDは予約語のため使用できません",
  createErrorInvalid: "入力内容を確認してください",
  createErrorFailed: "作成に失敗しました",

  /** 編集フォーム */
  editTitle: "コミュニティを編集",
  noPermission: "このコミュニティの編集権限がありません。",
  bannerLabel: "バナー",
  bannerPick: "バナーを選ぶ",
  iconLabel: "アイコン",
  iconPick: "アイコンを選ぶ",
  slugFixed: "コミュニティID（@{{slug}}）は変更できません。",
  linksLabel: "リンク",
  linkLabel: "ラベル",
  linkAdd: "+ リンクを追加",
} as const;

const en: Record<keyof typeof ja, string> = {
  notFound: "This community could not be found.",
  empty: "No communities yet.",
  create: "Create a community",

  memberCountOne: "{{n}} member",
  memberCount: "{{n}} members",
  eventCountOne: "{{n}} event",
  eventCount: "{{n}} events",
  likeCountOne: "{{n}} like",
  likeCount: "{{n}} likes",

  kpi: "See the numbers",
  follow: "Follow",

  deleteTitle: "Delete this community?",
  deleteBody:
    "This deletes “{{name}}”. Its events are kept but will no longer belong to a community. This cannot be undone.",

  membersHeading: "Members ({{n}})",
  membersEmpty: "No members yet.",
  makeAdmin: "Make admin",
  makeMember: "Change back to member",
  transferOwner: "Transfer ownership",
  transferConfirm:
    "Transfer ownership to {{name}}? You will become an admin. Continue?",

  slugLabel: "Community ID (used in the URL)",
  slugHelp:
    "3–32 characters: lowercase letters, numbers, and hyphens (must start and end with a letter or number)",
  slugPreview: "Public URL: /c/{{slug}}",
  nameLabel: "Community name",
  descriptionLabel: "Description",
  markdownHelp: "Markdown is supported",
  createSubmit: "Create",
  createErrorTaken: "That ID is already taken",
  createErrorReserved: "That ID is reserved and cannot be used",
  createErrorInvalid: "Please check what you entered",
  createErrorFailed: "The community could not be created",

  editTitle: "Edit community",
  noPermission: "You do not have permission to edit this community.",
  bannerLabel: "Banner",
  bannerPick: "Choose a banner",
  iconLabel: "Icon",
  iconPick: "Choose an icon",
  slugFixed: "The community ID (@{{slug}}) cannot be changed.",
  linksLabel: "Links",
  linkLabel: "Label",
  linkAdd: "+ Add a link",
};

export const community = { ja, en };
