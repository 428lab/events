/**
 * イベントのたまご（あったらいいな）の一覧・詳細・投稿フォームの文言 (#366)。
 *
 * 英語の呼び方は **たまご = egg / 「あったらいいな」 = wish** (#378)。
 * egg は入れ物、wish は中身。孵化の言い回し（`hatchedHeading`,
 * `eventDetail.fromRequest`）と同じ線でつながる、製品固有の呼び名。
 * `errors.request_not_found` と `venue.useTargetEgg` もこの綴りに合わせる。
 * なお `schedule.*` の "idea" はタイムテーブルの「ネタ」で別物。
 *
 * ここに置かないもの:
 * - 「イベント」（切り替えタブ）は `events.title`
 * - 開催形態（オフライン・オンライン・ハイブリッド）は `venueType` の表
 * - 「コミュニティ（任意）」は `eventForm.community`（イベント作成と同じ綴り）
 * - 「削除」「キャンセル」「投稿」「読み込み中…」
 *   「読み込めませんでした。再読み込みしてください。」は `common.*`
 *
 * 数の入れ替えは {{n}} を使う（`count` は i18next の複数形の仕組みを起動するため）。
 */
const ja = {
  /** 一覧の見出し。切り替えタブ・コミュニティ詳細の節でも同じ綴り */
  title: "イベントのたまご",
  /** 案内文はボタンの名前を引用するので、綴りは `willHost` から差し込む */
  lead: "「こんなイベントがあったらいいな」を投稿して、賛同を集めよう。誰かが「{{action}}」したらイベントに孵ります",

  /* ── 一覧 ─────────────────────────────────────────────── */
  searchPlaceholder: "キーワードで検索（タイトル・説明）",
  sortNew: "新着順",
  sortPopular: "人気順",
  emptyFiltered: "条件に合うたまごが見つかりませんでした。",
  empty: "まだたまごはありません。最初の「あったらいいな」を投稿してみましょう。",
  /** コミュニティ詳細の節に出す 0 件の案内（一覧より短い） */
  emptyInCommunity: "まだたまごはありません。",
  /** コミュニティ詳細から投稿する導線 */
  postWish: "あったらいいなを投稿",
  feedSubscribe: "たまごをフィードで購読:",

  /* ── カードと詳細で共通の印 ───────────────────────────── */
  closed: "クローズ",
  venuePref: "希望: {{venue}}",
  membersOnly: "メンバー限定",
  venueWantedChip: "会場募集中",
  /** 賛同の数。数の付かない側は賛同者一覧の見出しにも使う。
   *  **数えている名詞が文に出ない**ので、英語も単数・複数で綴りが変わらない
   *  （単数用のキーは要らない） */
  attend: "参加したい",
  attendCount: "参加したい {{n}}",
  host: "開催してもいい",
  hostCount: "開催してもいい {{n}}",
  /** こちらは英語に "event(s)" が出るので単数用のキーが要る */
  hatchedCountOne: "開催決定 {{n}}",
  hatchedCount: "開催決定 {{n}}",

  /* ── 詳細 ─────────────────────────────────────────────── */
  notFound: "たまごが見つかりませんでした。",
  /** 短いシェアURL (/r/:slug) から辿れなかったとき。日本語が上と違う
   *  （見つかりません／見つかりませんでした）ので、綴りを変えずに別のキーにする */
  notFoundShort: "たまごが見つかりません。",
  byline: "{{name}} さんの「あったらいいな」",
  willHost: "開催します",
  signInRequired: "賛同や開催宣言にはログインが必要です。",
  reactError:
    "賛同できませんでした。コミュニティのたまごへの賛同はメンバーのみです。",
  closeAction: "クローズする",
  reopen: "再オープン",
  venueWantedStop: "会場募集を止める",
  venueWantedStart: "会場も募集する",
  reactorsShow: "賛同者を表示する",
  reactorsHide: "賛同者を匿名にする",
  deleteConfirm: "このたまごを削除しますか？",
  hatchedHeading: "このたまごから生まれたイベント",

  /* ── 投稿フォーム ─────────────────────────────────────── */
  newTitle: "たまごを投稿",
  /** 案内文はボタンの名前を引用するので、綴りは `host` から差し込む */
  newLead:
    "「こんなイベントがあったらいいな」を投稿すると、賛同や「{{action}}」が集まります。誰かが開催を宣言したら通知が届きます。",
  titleLabel: "あったらいいなイベント",
  titlePlaceholder: "例: もくもく会を毎週やってほしい",
  descriptionLabel: "詳しく（任意）",
  descriptionPlaceholder: "どんな内容・雰囲気・場所でやってほしい？",
  venuePrefLabel: "希望の開催形態（任意）",
  communityHelp: "選ぶとコミュニティのたまごとして表示されます",
  communityNone: "なし（全体公開）",
  venueWantedSwitch: "会場も探しています（会場提供者からのオファーを受け付ける）",
  reactorsAnonSwitch: "賛同者を匿名にする（人数のみ表示）",
  membersOnlySwitch: "コミュニティメンバーだけに見せる",
  newSubmit: "投稿する",
} as const;

const en: Record<keyof typeof ja, string> = {
  title: "Event eggs",
  lead: "Post the events you wish existed and gather support. Once somebody says “{{action}}”, the egg hatches into a real event.",

  searchPlaceholder: "Search by keyword (title and details)",
  sortNew: "Newest",
  sortPopular: "Most popular",
  emptyFiltered: "No eggs match your search.",
  empty: "No eggs yet. Post the first wish.",
  emptyInCommunity: "No eggs yet.",
  postWish: "Post a wish",
  feedSubscribe: "Subscribe to these eggs:",

  closed: "Closed",
  venuePref: "Preferred: {{venue}}",
  membersOnly: "Members only",
  venueWantedChip: "Venue wanted",
  attend: "Want to join",
  attendCount: "Want to join {{n}}",
  host: "Could host it",
  hostCount: "Could host it {{n}}",
  hatchedCountOne: "{{n}} event happening",
  hatchedCount: "{{n}} events happening",

  notFound: "This egg could not be found.",
  notFoundShort: "This egg could not be found.",
  byline: "{{name}}'s wish",
  willHost: "I will host it",
  signInRequired: "Sign in to support an egg or offer to host it.",
  reactError:
    "Your support could not be added. Only members can support a community's eggs.",
  closeAction: "Close this egg",
  reopen: "Reopen",
  venueWantedStop: "Stop looking for a venue",
  venueWantedStart: "Look for a venue too",
  reactorsShow: "Show who supported it",
  reactorsHide: "Hide who supported it",
  deleteConfirm: "Delete this egg?",
  hatchedHeading: "Events hatched from this egg",

  newTitle: "Post an egg",
  newLead:
    "Post the event you wish existed, and people can support it or say “{{action}}”. You are notified as soon as somebody offers to run it.",
  titleLabel: "The event you wish existed",
  titlePlaceholder: "e.g. A weekly co-working session",
  descriptionLabel: "Details (optional)",
  descriptionPlaceholder:
    "What should it cover? What kind of atmosphere and place?",
  venuePrefLabel: "Preferred format (optional)",
  communityHelp: "Pick one to post this as that community's egg",
  communityNone: "None (public)",
  venueWantedSwitch:
    "Looking for a venue too (accept offers from venue hosts)",
  reactorsAnonSwitch: "Hide who supported it (show only the count)",
  membersOnlySwitch: "Show only to members of the community",
  newSubmit: "Post",
};

export const egg = { ja, en };
