/** ログイン画面の文言 (#352) */
const ja = {
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
} as const;

const en: Record<keyof typeof ja, string> = {
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
};

export const login = { ja, en };
