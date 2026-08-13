/**
 * 会場の一覧・詳細・登録/編集フォーム・写真・オファーの文言 (#366)。
 *
 * ここに置かないもの:
 * - 見出しの「会場」は `nav.venues`
 * - 「会場を探しています」（募集中の節の見出し）は `eventForm.venueWanted` と
 *   同じ綴りなので新設しない
 * - 「削除」「編集」「保存」「キャンセル」「追加」「閉じる」「読み込み中…」
 *   「読み込めませんでした。再読み込みしてください。」「写真」「写真（{{n}}）」
 *   「この写真を削除しますか？」は `common.*`
 * - 開催形態（オフライン・オンライン・ハイブリッド）は `venueType`（labels.ts）の表
 * - 名簿CSVのボタンは `staffOps.attendanceCsv`（主催者が落とすのと同じ CSV）。
 *   会場側にしか出ない注意書きだけ `attendanceCsvNote` としてここに置く
 *
 * **`labels.ts` の開催形態を `venue` に戻さないこと (#366)。** index.ts が
 * `...labels.ja` を**この名前空間より後ろに展開する**ので、あちらが `venue`
 * だと会場の文言が3語の開催形態の表で丸ごと上書きされて消える。
 * `venueType` への改名は見た目の整理ではなく、衝突を避けるために要る。
 *
 * オファーの状態とエラーはサーバーが返すコードで引くので、`venueOfferStatus` /
 * `venueOfferError` として別に輸出する（`tDynamic` から引く）。
 *
 * 数の入れ替えは {{n}} を使う（`count` は i18next の複数形の仕組みを起動するため）。
 */
const ja = {
  /* ── 一覧 ─────────────────────────────────────────────── */
  lead: "イベントに使える会場。会場を持っている人は登録して主催者とつながれます",
  /** 登録する導線。一覧のボタンと登録フォームの見出しで同じ綴り */
  register: "会場を登録",
  empty: "まだ会場はありません。最初の会場を登録してみましょう。",
  /** 受付を止めている会場の印。一覧カードと詳細の両方に出る */
  closed: "受付停止中",
  /** 収容人数。利用者が入れた数なので 1 もありうる（英語の単数用キーが要る） */
  capacityOne: "〜{{n}}人",
  capacity: "〜{{n}}人",
  /** 会場を探しているイベント・たまごの節。見出しは `eventForm.venueWanted`。
   *  案内文がボタンの名前を引用するので、綴りは `offerCta` から差し込む */
  wantedLead:
    "会場を提供できる場合は、各ページの「{{action}}」からオファーを送れます",

  /* ── 詳細 ─────────────────────────────────────────────── */
  notFound: "会場が見つかりませんでした。",
  addressHidden: "詳細な住所はマッチング成立後に開示されます",
  ownerLabel: "提供者:",
  mapTitle: "会場の地図",
  mapOpen: "Googleマップで開く",
  equipmentHeading: "設備",
  termsHeading: "提供条件",
  contactNotice: "連絡先（マッチング相手にのみ開示）: {{contact}}",

  /* ── 登録・編集フォーム ───────────────────────────────── */
  noPermission: "この会場の編集権限がありません。",
  editTitle: "会場を編集",
  formLead:
    "イベント主催者に使ってもらえる会場を登録します。連絡先はマッチング成立まで公開されません。",
  nameLabel: "会場名",
  descriptionLabel: "紹介（任意）",
  descriptionHelp: "Markdown が使えます。雰囲気・アクセス・利用例など",
  areaLabel: "エリア",
  areaPlaceholder: "例: 東京都渋谷区",
  areaHelp: "一覧・詳細に公開される場所情報",
  addressLabel: "詳細住所（任意）",
  addressPublicLabel: "詳細住所を公開する（OFF: マッチング成立後にのみ開示）",
  capacityLabel: "収容人数（任意）",
  equipmentLabel: "設備（任意）",
  equipmentPlaceholder: "Wi-Fi / プロジェクター / ホワイトボード など",
  termsLabel: "提供条件（任意）",
  termsPlaceholder: "平日夜と週末のみ / 飲食可 / 原状回復お願いします など",
  contactLabel: "連絡先（マッチング相手にのみ開示）",
  contactPlaceholder: "X: @xxx / Discord: xxx / メール等",
  coverPick: "カバー写真を選択",
  coverPreviewAlt: "プレビュー",
  acceptOffers: "提供を受け付ける",
  saveError: "保存に失敗しました。入力内容を確認してください。",
  imageUploadFailed:
    "会場情報は保存されましたが、写真のアップロードに失敗しました。6MB以下の JPEG/PNG/WebP で再試行してください。",
  /** `common.retry`（もう一度）とは綴りが違うので別に持つ */
  imageRetry: "再試行",
  skipPhoto: "写真なしで進む",
  createSubmit: "登録する",
  deleteConfirm: "この会場を削除しますか？",

  /* ── 管理者（オーナーのみ） ───────────────────────────── */
  adminsHeading: "管理者",
  adminsLead:
    "管理者は会場の編集・写真の承認・オファー対応ができます（削除・管理者の変更・移譲はオーナーのみ）。",
  adminAddLabel: "ユーザー名で追加",
  adminAddPlaceholder: "例: kojira",
  adminAddError: "追加できませんでした（ユーザー名を確認してください）。",
  adminsEmpty: "管理者はまだいません。",
  adminRemove: "解除",
  /** コミュニティの「オーナー譲渡」とは綴りが違う（移譲／譲渡）ので別に持つ */
  transferOwner: "オーナー移譲",
  transferConfirm:
    "{{name}} さんにオーナーを移譲しますか？あなたは管理者になります。",

  /* ── 写真 ─────────────────────────────────────────────── */
  photoAddOwner: "写真を追加（最大{{n}}点）",
  photoSubmit: "写真を投稿（管理者の確認後に公開）",
  /** 送っている間の表示は `common.uploading`（スライドの画像と同じ綴り, #367） */
  /** 上限は固定の定数（10点）なので英語の単数用キーは要らない */
  photoLimit: "写真は最大 {{n}} 点までです。",
  /** 残り枠は 1 になりうるので単数用のキーが要る */
  photoRoomOne: "あと {{n}} 点まで追加できます。",
  photoRoom: "あと {{n}} 点まで追加できます。",
  photoUploadError:
    "アップロードに失敗しました。画像形式・サイズを確認してください。",
  photoSubmitted: "投稿しました。会場管理者の確認後に公開されます。",
  photoAlt: "会場写真",
  pendingHeading: "承認待ちの投稿（{{n}}）",
  pendingAlt: "承認待ち写真",
  pendingBy: "{{name}} さんの投稿",
  photoApprove: "採用",
  photoReject: "却下",
  photoRejectConfirm: "この投稿を却下して削除しますか？",

  /* ── オファー ─────────────────────────────────────────── */
  offersHeading: "会場オファー",
  ownerOffersHeading: "この会場へのオファー",
  /** 一覧の行の頭。うしろにリンクが続くので、空きは画面側が入れる */
  directionOffer: "提供オファー:",
  directionRequest: "利用申込:",
  /** リンクにする会場の名前が引けなかったときの受け皿。`nav.venues` は
   *  一覧の見出し（複数）なので、1つの会場を指すここでは英語が違う */
  nameFallback: "会場",
  accept: "承諾",
  decline: "辞退",
  acceptSubmit: "承諾する",
  /** マッチング成立の知らせ。**足し算で組み立てない**（語順が言語で変わる）。
   *  差し込む中身は住所・連絡先を `detailSeparator` でつないだもの。
   *
   *  元は `住所` と `連絡先` をそれぞれ前置きの区切りごと足していたので、
   *  **住所が空で連絡先だけあると `マッチング成立！ ／ 連絡先: …` と
   *  区切りが先頭に出ていた**。ある分だけつなぐ形にしたので、この場合の
   *  日本語だけ `／` が消える（#366 で日本語の出力が変わる唯一の箇所） */
  matched: "マッチング成立！ {{details}}（以後の相談は直接どうぞ）",
  matchedAddress: "住所: {{address}}",
  matchedContact: "連絡先: {{contact}}",
  detailSeparator: " ／ ",
  matchedOrganizer:
    "マッチング成立！ 主催者の連絡先: {{contact}}（以後の相談は直接どうぞ）",
  matchedWaiting:
    "マッチング成立！ 主催者からの連絡をお待ちください（あなたの連絡先が開示されています）",
  acceptTitle: "オファーを承諾",
  acceptLead:
    "承諾すると会場側の連絡先・住所が開示されます。あなたの連絡先も伝えるとやりとりがスムーズです。",
  myContactLabel: "あなたの連絡先（任意・相手にのみ開示）",
  myContactPlaceholder: "X: @xxx / Discord: xxx など",
  offerCta: "会場を提供できます",
  offerTitle: "会場を提供する",
  offerVenueLabel: "提供する会場",
  offerSubmit: "オファーを送る",
  useCta: "この会場を使いたい",
  useTitle: "会場の利用を申し込む",
  useTargetLabel: "対象（イベント / たまご）",
  useTargetEgg: "たまご: {{title}}",
  useContactLabel: "あなたの連絡先（承諾後に会場側へ開示）",
  useSubmit: "申し込む",
  /** 名簿を落とした会場オーナー向けの注意書き。**ボタンの名前は
   *  `staffOps.attendanceCsv`**（主催者が落とすのと同じ CSV）。ここには
   *  会場側にしか出ない注意書きだけを置く */
  attendanceCsvNote:
    "入館管理のためにご利用ください。個人情報の取り扱いにご注意ください",
} as const;

const en: Record<keyof typeof ja, string> = {
  lead: "Venues you can use for events. If you have a space, list it here and connect with organizers.",
  register: "List a venue",
  empty: "No venues yet. Be the first to list one.",
  closed: "Not accepting requests",
  capacityOne: "Up to {{n}} person",
  capacity: "Up to {{n}} people",
  wantedLead:
    "If you can offer a space, open one of these pages and send an offer from “{{action}}”.",

  notFound: "This venue could not be found.",
  addressHidden: "The full address is shared once a match is made.",
  ownerLabel: "Host:",
  mapTitle: "Map of the venue",
  mapOpen: "Open in Google Maps",
  equipmentHeading: "Facilities",
  termsHeading: "Terms",
  contactNotice: "Contact (shared only with a matched organizer): {{contact}}",

  noPermission: "You do not have permission to edit this venue.",
  editTitle: "Edit venue",
  formLead:
    "List a space that event organizers can use. Your contact details stay private until a match is made.",
  nameLabel: "Venue name",
  descriptionLabel: "Introduction (optional)",
  descriptionHelp:
    "Markdown is supported. Describe the atmosphere, how to get there, what it suits.",
  areaLabel: "Area",
  areaPlaceholder: "e.g. Shibuya, Tokyo",
  areaHelp: "The location shown publicly on the list and detail pages",
  addressLabel: "Full address (optional)",
  addressPublicLabel:
    "Show the full address publicly (off: shared only after a match)",
  capacityLabel: "Capacity (optional)",
  equipmentLabel: "Facilities (optional)",
  equipmentPlaceholder: "Wi-Fi / projector / whiteboard, and so on",
  termsLabel: "Terms (optional)",
  termsPlaceholder:
    "Weekday evenings and weekends only / food and drink allowed / please leave it as you found it",
  contactLabel: "Contact (shared only with a matched organizer)",
  contactPlaceholder: "X: @xxx / Discord: xxx / email, and so on",
  coverPick: "Choose a cover photo",
  coverPreviewAlt: "Preview",
  acceptOffers: "Accept offers",
  saveError: "Could not save. Please check what you entered.",
  imageUploadFailed:
    "The venue was saved, but the photo could not be uploaded. Try again with a JPEG, PNG, or WebP under 6 MB.",
  imageRetry: "Try again",
  skipPhoto: "Continue without the photo",
  createSubmit: "List the venue",
  deleteConfirm: "Delete this venue?",

  adminsHeading: "Admins",
  adminsLead:
    "Admins can edit the venue, approve photos, and respond to offers. Only the owner can delete it, change admins, or transfer ownership.",
  adminAddLabel: "Add by username",
  adminAddPlaceholder: "e.g. kojira",
  adminAddError: "Could not add them. Please check the username.",
  adminsEmpty: "No admins yet.",
  adminRemove: "Remove",
  transferOwner: "Transfer ownership",
  transferConfirm:
    "Transfer ownership to {{name}}? You will become an admin.",

  photoAddOwner: "Add photos (up to {{n}})",
  photoSubmit: "Submit a photo (published after an admin reviews it)",
  photoLimit: "A venue can have at most {{n}} photos.",
  photoRoomOne: "You can add {{n}} more photo.",
  photoRoom: "You can add {{n}} more photos.",
  photoUploadError:
    "The upload failed. Please check the image format and size.",
  photoSubmitted: "Submitted. It goes live once a venue admin approves it.",
  photoAlt: "Venue photo",
  pendingHeading: "Waiting for review ({{n}})",
  pendingAlt: "Photo waiting for review",
  pendingBy: "Submitted by {{name}}",
  photoApprove: "Approve",
  photoReject: "Reject",
  photoRejectConfirm: "Reject and delete this submission?",

  offersHeading: "Venue offers",
  ownerOffersHeading: "Offers for this venue",
  directionOffer: "Venue offer:",
  directionRequest: "Booking request:",
  nameFallback: "Venue",
  accept: "Accept",
  decline: "Decline",
  acceptSubmit: "Accept",
  matched: "It's a match! {{details}} (You can talk directly from here on.)",
  matchedAddress: "Address: {{address}}",
  matchedContact: "Contact: {{contact}}",
  detailSeparator: " / ",
  matchedOrganizer:
    "It's a match! The organizer's contact: {{contact}} (You can talk directly from here on.)",
  matchedWaiting:
    "It's a match! Wait for the organizer to get in touch — they can now see your contact details.",
  acceptTitle: "Accept the offer",
  acceptLead:
    "Accepting reveals the venue's contact details and address. Sharing your own contact details makes it easier to talk.",
  myContactLabel: "Your contact details (optional, shared only with them)",
  myContactPlaceholder: "X: @xxx / Discord: xxx, and so on",
  offerCta: "I can offer a venue",
  offerTitle: "Offer a venue",
  offerVenueLabel: "Venue to offer",
  offerSubmit: "Send the offer",
  useCta: "I would like to use this venue",
  useTitle: "Request to use this venue",
  useTargetLabel: "For (an event or an egg)",
  useTargetEgg: "Egg: {{title}}",
  useContactLabel:
    "Your contact details (shared with the venue once they accept)",
  useSubmit: "Send the request",
  attendanceCsvNote:
    "Please use this for building access only, and handle the personal data with care.",
};

/**
 * オファーの状態 (#366)。サーバーが返すコードで引く。
 *
 * チップの色とアイコンは文言ではないので画面側に残してある。辞書に無い状態は
 * `tDynamic` の既定値で生のコードを出す（元の `?? status` と同じ受け皿）。
 */
const statusJa = {
  pending: "回答待ち",
  accepted: "成立",
  declined: "見送り",
} as const;

const statusEn: Record<keyof typeof statusJa, string> = {
  pending: "Waiting for a reply",
  accepted: "Matched",
  declined: "Declined",
};

/**
 * オファーの送信・応答が断られたときの文言 (#366)。サーバーが返すコードで引く。
 *
 * `*_unavailable` は相手が退会申請中（猶予期間 #250）で、承諾すると連絡先や
 * 非公開住所が開示されてしまうケース。**相手の退会は伏せた言い方にする**。
 * 辞書に無いコードは `default` に落ちる。
 */
const offerErrorJa = {
  venue_unavailable: "この会場は現在オファーを受け付けていません。",
  target_unavailable: "オファー先の主催者が現在応答できない状態です。",
  counterparty_unavailable:
    "相手が現在応答できない状態のため、いま承諾はできません（見送りは可能です）。",
  already_offered: "同じ会場で既にオファー済みです。",
  declined_recently: "直近で見送られたため、しばらくは再オファーできません。",
  default: "送信できませんでした。時間をおいて再度お試しください。",
} as const;

const offerErrorEn: Record<keyof typeof offerErrorJa, string> = {
  venue_unavailable: "This venue is not accepting offers right now.",
  target_unavailable: "The organizer cannot respond right now.",
  counterparty_unavailable:
    "The other side cannot respond right now, so you cannot accept yet (you can still decline).",
  already_offered: "You have already made an offer with this venue.",
  declined_recently:
    "This was declined recently, so you cannot offer again for a while.",
  default: "This could not be sent. Please wait a moment and try again.",
};

export const venue = { ja, en };
export const venueOfferStatus = { ja: statusJa, en: statusEn };
export const venueOfferError = { ja: offerErrorJa, en: offerErrorEn };
