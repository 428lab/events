/** 共催コミュニティの文言 (#625)。docs/event-cohost.md
 * 数の差し込みは {{n}}（eventDetail.ts と同じく i18next の count は使わない） */
const ja = {
  /** 詳細ページ・一覧カードで共催に添える短いラベル */
  label: "共催",

  /** 運営ページ（その場で管理） */
  manageTitle: "共催コミュニティ",
  manageIntro:
    "共催コミュニティには運営の権限は付きません。運営に入ってほしい人は運営スタッフ招待で招いてください。",
  manageHowTo:
    "相手のコミュニティの owner/admin が承認すると、イベントの詳細と相手のコミュニティページのイベント一覧に共催として載ります。",
  pickerLabel: "共催コミュニティを追加",
  pickerPlaceholder: "コミュニティ名で検索",
  pickerHelp:
    "自分が管理しているコミュニティは、承認なしですぐ共催になります。一覧に無いコミュニティは、URL か slug を入れて Enter で依頼できます。",
  pickerNoMatch: "見つかりません。URL か slug を入れて Enter で依頼できます。",
  groupOwn: "自分が管理しているコミュニティ",
  groupOther: "ほかのコミュニティ",
  optionInstant: "すぐ共催",
  optionRequest: "承認待ちで依頼",
  addedInstant: "{{name}} を共催に追加しました。",
  addedRequest: "{{name}} に共催を依頼しました。承認されると共催になります。",
  limitReached: "共催コミュニティは {{n}} 件までです。追加するには、どれかを外してください。",
  manageEmpty: "共催コミュニティはありません。",
  statusPending: "承認待ち",
  statusAccepted: "共催中",
  remove: "外す",
  removeConfirmTitle: "共催から外しますか？",
  removeConfirmBody:
    "{{name}} を共催から外します。共催中だった場合は、相手のコミュニティページのイベント一覧からも消えます。相手には通知しません。",

  /** 申請のエラー（サーバーのコード別） */
  errorDefault: "共催を依頼できませんでした。時間をおいて試してください。",
  errorCommunityNotFound: "そのコミュニティは見つかりませんでした。URL か slug を確かめてください。",
  errorHostCommunity: "主催のコミュニティは共催にできません。",
  errorAlreadyCohost: "そのコミュニティには依頼済みか、すでに共催中です。",
  errorLimit: "共催コミュニティは {{n}} 件までです。",
  actionError: "操作できませんでした。画面を再読み込みしてください。",

  /** コミュニティ編集ページ（共催先の owner/admin） */
  communityTitle: "共催",
  communityIntro:
    "このコミュニティに届いた共催の依頼です。承諾すると、イベントの詳細とこのコミュニティのイベント一覧に共催として載ります。運営の権限は付きません。",
  communityEmpty: "共催の依頼はありません。",
  requestsHeading: "依頼中",
  activeHeading: "共催中",
  hostedBy: "主催: {{name}}",
  dateTbd: "日程未定",
  /** 閲覧できないイベント（題名・日時が伏せて返る）の代わりの表示 */
  hiddenEvent: "非公開のイベント",
  accept: "承諾",
  decline: "辞退",
  stop: "共催をやめる",
  stopConfirmTitle: "共催をやめますか？",
  stopConfirmBody:
    "「{{title}}」の共催をやめます。このコミュニティのイベント一覧から消えます。もう一度共催するには、主催側から依頼し直してもらう必要があります。",
} as const;

const en: Record<keyof typeof ja, string> = {
  label: "Co-host",

  manageTitle: "Co-host communities",
  manageIntro:
    "Co-host communities get no organizer permissions. To bring people in as organizers, invite them as organizer staff.",
  manageHowTo:
    "Once an owner or admin of the other community accepts, the event shows them as a co-host and appears in their community's event list.",
  pickerLabel: "Add a co-host community",
  pickerPlaceholder: "Search by community name",
  pickerHelp:
    "Communities you manage become co-hosts right away, without approval. For a community not in the list, type its URL or slug and press Enter to send a request.",
  pickerNoMatch: "No match. Type a URL or slug and press Enter to send a request.",
  groupOwn: "Communities you manage",
  groupOther: "Other communities",
  optionInstant: "Added now",
  optionRequest: "Needs approval",
  addedInstant: "Added {{name}} as a co-host.",
  addedRequest: "Sent a co-host request to {{name}}. It becomes a co-host once they accept.",
  limitReached: "You can have up to {{n}} co-host communities. Remove one to add another.",
  manageEmpty: "No co-host communities.",
  statusPending: "Awaiting approval",
  statusAccepted: "Co-hosting",
  remove: "Remove",
  removeConfirmTitle: "Remove this co-host?",
  removeConfirmBody:
    "{{name}} will be removed as a co-host. If they were co-hosting, the event also disappears from their community's event list. They will not be notified.",

  errorDefault: "Could not send the co-host request. Please try again later.",
  errorCommunityNotFound: "That community was not found. Check the URL or slug.",
  errorHostCommunity: "The host community cannot be a co-host.",
  errorAlreadyCohost: "That community already has a request or is already co-hosting.",
  errorLimit: "You can have up to {{n}} co-host communities.",
  actionError: "Could not complete that. Please reload the page.",

  communityTitle: "Co-hosting",
  communityIntro:
    "Co-host requests sent to this community. Accepting lists the event as co-hosted on its page and in this community's event list. No organizer permissions are granted.",
  communityEmpty: "No co-host requests.",
  requestsHeading: "Requests",
  activeHeading: "Co-hosting",
  hostedBy: "Host: {{name}}",
  dateTbd: "Date not set",
  hiddenEvent: "Private event",
  accept: "Accept",
  decline: "Decline",
  stop: "Stop co-hosting",
  stopConfirmTitle: "Stop co-hosting?",
  stopConfirmBody:
    "You will stop co-hosting “{{title}}”. It will disappear from this community's event list. To co-host again, the host has to send a new request.",
};

export const cohost = { ja, en };
