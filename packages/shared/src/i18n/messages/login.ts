/** ログイン画面の文言 (#352) */
const ja = {
  /** 未ログインの公開ページのヘッダーにあるログイン導線 (#366)。
   *  会場・たまごの公開ページの「枠」なので、中身と一緒に訳す */
  signIn: "ログイン",
  tagline: "募集から配信まで全部やる、イベント運営ツール",
  signInWith: "{{provider}} でログイン",
  checking: "確認中…",
  signInFailed: "ログインに失敗しました。",
  // 拡張機能・アプリの名前は利用者が探すときの手がかりなので、そのまま残す
  extensionHint:
    "ブラウザ拡張機能（Alby、nos2x など）か、Amber などの署名アプリでログインできます。秘密鍵を入力する必要はありません。",

  /** 署名アプリ（NIP-46 の nostrconnect://）でつなぐシート (D-NOSTR-SIGNER) */
  signerTitle: "署名アプリでログイン",
  signerLinkTitle: "署名アプリで連携",
  signerOpenApp: "Amber で開く",
  signerReturnHint: "署名アプリで承認したら、このページに戻ってください。",
  signerQrHint: "スマホの署名アプリ（Amber など）でこの QR を読み取ってください。",
  signerQrLabel: "署名アプリでつなぐための QR コード",
  signerAppRequired: "Amber（Android）などの、Nostr Connect に対応した署名アプリが必要です。",
  signerWaiting: "署名アプリからの応答を待っています…",
  signerApproveSign: "署名アプリで、ログインの署名を承認してください。",
  signerSavedWaiting: "前回つないだ署名アプリで署名を待っています…",
  signerSavedHint: "Amber などの署名アプリで承認してください（通知から開けます）。",
  signerUseAnother: "別の署名アプリでつなぐ",
  signerTimeout: "署名アプリからの応答がありませんでした。もう一度お試しください。",
  signerSignTimeout: "署名が承認されませんでした。もう一度お試しください。",
  signerRejected: "署名アプリで署名が断られました。",
  signerRelayFailed: "リレーにつながりませんでした。時間をおいて試してください。",
  /** Android の Amber を直接呼ぶ（NIP-55）入口と、戻ってくるページ (D-NOSTR-SIGNER PR-B) */
  signerAmberLogin: "Amber でログイン",
  signerAmberLink: "Amber で連携",
  signerAmberHint: "Amber が開きます。承認すると、このブラウザに戻ってきます。",
  signerOtherApp: "ほかの署名アプリ（Nostr Connect）",
  signerAmberFailed: "Amber を開けませんでした。もう一度お試しください。",
  signerCallbackSigningIn: "ログインしています…",
  signerCallbackLinking: "連携しています…",
  signerCallbackInvalid: "署名アプリから署名を受け取れませんでした。もう一度お試しください。",
  signerBackToLogin: "ログイン画面に戻る",
  signerBackToAccount: "アカウント設定に戻る",
  devLogin: "開発用ログイン",
  devLoginNote: "※ 開発用ログインは開発環境でのみ動作します",

  /** Bluesky のログイン・連携 (#381)。ハンドルを聞いてから外部の許可画面へ飛ぶ。
   *  「Bluesky」「ハンドル」以外の言葉（DID など内部の仕組みの呼び名）は出さない */
  blueskyHandleLabel: "Bluesky のハンドル",
  blueskyHandlePlaceholder: "yourname.bsky.social",
  blueskyHandleHelp:
    "先頭の @ は付けても付けなくてもかまいません。続けて Bluesky の画面で許可すると戻ってきます。",
} as const;

const en: Record<keyof typeof ja, string> = {
  signIn: "Sign in",
  tagline: "Run your event end to end, from sign-ups to the live stream.",
  signInWith: "Sign in with {{provider}}",
  checking: "Checking…",
  signInFailed: "Sign-in failed.",
  extensionHint:
    "Sign in with a browser extension (Alby, nos2x, and so on) or a signer app such as Amber. You never need to enter your secret key.",

  signerTitle: "Sign in with a signer app",
  signerLinkTitle: "Link with a signer app",
  signerOpenApp: "Open Amber",
  signerReturnHint: "After you approve in the signer app, come back to this page.",
  signerQrHint: "Scan this QR code with a signer app on your phone (such as Amber).",
  signerQrLabel: "QR code for connecting a signer app",
  signerAppRequired: "You need a signer app that supports Nostr Connect, such as Amber (Android).",
  signerWaiting: "Waiting for the signer app to respond…",
  signerApproveSign: "Approve the sign-in signature in your signer app.",
  signerSavedWaiting: "Waiting for a signature from the signer app you connected last time…",
  signerSavedHint: "Approve it in your signer app, such as Amber (you can open it from the notification).",
  signerUseAnother: "Connect a different signer app",
  signerTimeout: "The signer app did not respond. Please try again.",
  signerSignTimeout: "The signature was not approved. Please try again.",
  signerRejected: "The signer app declined to sign.",
  signerRelayFailed: "Could not reach the relays. Please wait a moment and try again.",
  signerAmberLogin: "Sign in with Amber",
  signerAmberLink: "Link with Amber",
  signerAmberHint: "Amber will open. After you approve, you will come back to this browser.",
  signerOtherApp: "Other signer apps (Nostr Connect)",
  signerAmberFailed: "Could not open Amber. Please try again.",
  signerCallbackSigningIn: "Signing in…",
  signerCallbackLinking: "Linking…",
  signerCallbackInvalid: "We did not receive a signature from the signer app. Please try again.",
  signerBackToLogin: "Back to sign-in",
  signerBackToAccount: "Back to account settings",
  devLogin: "Development sign-in",
  devLoginNote: "Development sign-in only works in a development environment.",

  blueskyHandleLabel: "Bluesky handle",
  blueskyHandlePlaceholder: "yourname.bsky.social",
  blueskyHandleHelp:
    "The leading @ is optional. You will be sent to Bluesky to approve, then brought back here.",
};

export const login = { ja, en };

/**
 * Bluesky のログイン・連携が途中で失敗した理由 (#381)。
 *
 * **`linkError` とは別の名前空間**にしてある。`linkError` は知らないコードを
 * 「別ユーザーに連携済み」の文言に落とすので、ここのコードを混ぜると
 * 誤った説明が出る（設計 12）。キーはサーバーが返すコードそのもの。
 *
 * 断られた場合 (`denied`) はエラー扱いにせず画面に戻すだけなので、ここには無い。
 * 内部の仕組みの呼び名（DID・PDS など）は画面に出さない。
 */
const blueskyErrorJa = {
  default: "ログインできませんでした。時間をおいて試してください。",
  /** ハンドルから相手のアカウントに辿り着けなかった（入力の誤りか、無いアカウント） */
  handle_not_found:
    "そのハンドルのアカウントが見つかりませんでした。入力を確認してください（例: yourname.bsky.social）。",
  /** 接続先が落ちている・応答しない */
  unavailable: "Bluesky に接続できませんでした。時間をおいて試してください。",
  /** 認可開始から戻るまでに時間が経ちすぎた（持ち越しの期限は10分） */
  expired: "時間が経ちすぎました。もう一度やり直してください。",
  failed: "ログインできませんでした。時間をおいて試してください。",
} as const;

const blueskyErrorEn: Record<keyof typeof blueskyErrorJa, string> = {
  default: "Could not sign in. Please wait a moment and try again.",
  handle_not_found:
    "We could not find an account with that handle. Please check what you entered (for example, yourname.bsky.social).",
  unavailable: "We could not reach Bluesky. Please wait a moment and try again.",
  expired: "That took too long. Please start again.",
  failed: "Could not sign in. Please wait a moment and try again.",
};

export const blueskyError = { ja: blueskyErrorJa, en: blueskyErrorEn };
