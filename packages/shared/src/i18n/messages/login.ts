/** ログイン画面の文言 (#352) */
const ja = {
  /** 未ログインの公開ページのヘッダーにあるログイン導線 (#366)。
   *  会場・たまごの公開ページの「枠」なので、中身と一緒に訳す */
  signIn: "ログイン",
  tagline: "募集から配信まで全部やる、イベント運営ツール",
  signInWith: "{{provider}} でログイン",
  checking: "確認中…",
  // 拡張機能の名前は利用者が探すときの手がかりなので、そのまま残す
  extensionMissing:
    "対応する拡張機能（Alby、nos2x など）が見つかりません。インストールしてから再度お試しください。",
  signInFailed: "ログインに失敗しました。",
  extensionHint:
    "このログイン方法には、対応するブラウザ拡張機能（Alby、nos2x など）が必要です。",
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
  extensionMissing:
    "No supported browser extension (Alby, nos2x, and so on) was found. Please install one and try again.",
  signInFailed: "Sign-in failed.",
  extensionHint:
    "This sign-in method needs a supported browser extension (Alby, nos2x, and so on).",
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
