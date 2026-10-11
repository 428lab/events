/**
 * アカウント設定「AI 連携（アクセストークン）」カードの文言 (#581)。
 * 設計は docs/ai-integration.md §4.7・§6.3・§6.4・§6.6。
 *
 * Claude 側の画面名（Customize / Connectors / Add custom connector / No sign-in /
 * Request headers）は相手の画面に出る綴りのまま書く。日本語に訳すと探せなくなる。
 */
const ja = {
  title: "AI 連携（アクセストークン）",
  description:
    "Claude などの AI アシスタントから、あなたとしてイベントの情報を読み取ったり、イベントの下書きを作ったりするためのトークンです。AI が公開ボタンを押すことはありません。",
  leakNotice:
    "このトークンは Claude の設定にだけ貼ってください。他人に渡すと、その人があなたとして読み取り（と下書き作成）ができます。漏れたと思ったら、すぐに「失効」してください。ログインし直す必要はありません。",
  empty: "発行したトークンはまだありません。",
  issue: "トークンを発行",

  /** 一覧 */
  scopeRead: "読み取りのみ",
  scopeWrite: "読み取り・下書き作成",
  revokedChip: "失効済み",
  expiredChip: "期限切れ",
  createdAt: "作成 {{date}}",
  expiresAt: "期限 {{date}}",
  lastUsedAt: "最終使用 {{date}}",
  neverUsed: "未使用",
  revoke: "失効",

  /** 発行ダイアログ */
  issueTitle: "アクセストークンを発行",
  nameLabel: "名前",
  nameHelp: "どこで使うかが分かる名前（例: Claude Code）。40文字まで",
  scopeLabel: "できること",
  writeLabel: "書き込みも許可する（イベントの下書き作成）",
  writeHelp:
    "AI がイベントの下書きを作れるようになります（公開はしません）。AI が勝手に下書きを作る可能性があります。読み取り専用で始めることをおすすめします。",
  expiryLabel: "有効期限",
  expiryDays: "{{n}}日",
  issueRun: "発行する",
  issueFailed: "発行できませんでした。時間をおいて再度お試しください。",
  tooManyTokens:
    "有効なトークンは {{max}} 本までです。使っていないトークンを失効してから発行してください。",

  /** 発行直後の1回だけの表示 */
  issuedTitle: "トークンを発行しました",
  issuedOnce:
    "この画面を閉じると二度と表示されません。いまコピーして Claude の設定に貼ってください。",
  tokenLabel: "アクセストークン",
  copy: "コピー",
  claudeCodeTitle: "Claude Code で使う",
  claudeCodeHelp: "ターミナルで次のコマンドを実行します。",
  claudeAiTitle: "claude.ai / Claude Desktop で使う",
  claudeAiSteps:
    "Customize → Connectors → Add custom connector を開き、URL に下の値を入れ、Authentication は「No sign-in」を選びます。Request headers に名前「authorization」、値に下の「Bearer …」を入れます。",
  claudeAiNoHeaders:
    "Request headers の欄が出ない場合は、まだその機能が使えない組織です。Claude Code をお使いください。",
  mcpUrlLabel: "URL",
  headerValueLabel: "authorization の値",
  issuedDone: "閉じる",

  /** 失効の確認 */
  revokeTitle: "トークンを失効しますか？",
  revokeBody:
    "「{{name}}」（{{prefix}}…）を失効します。このトークンを設定した AI からは、すぐに使えなくなります。この操作は取り消せません。",
  revokeRun: "失効する",
  revokeFailed: "失効できませんでした。時間をおいて再度お試しください。",
};

const en: Record<keyof typeof ja, string> = {
  title: "AI integration (access tokens)",
  description:
    "Tokens that let AI assistants such as Claude read event information and create event drafts as you. The AI never presses the publish button.",
  leakNotice:
    "Paste this token only into your Claude settings. Anyone you give it to can read (and create drafts) as you. If you think it has leaked, revoke it right away. You do not need to sign in again.",
  empty: "You have not issued any tokens yet.",
  issue: "Issue token",

  scopeRead: "Read only",
  scopeWrite: "Read and create drafts",
  revokedChip: "Revoked",
  expiredChip: "Expired",
  createdAt: "Created {{date}}",
  expiresAt: "Expires {{date}}",
  lastUsedAt: "Last used {{date}}",
  neverUsed: "Never used",
  revoke: "Revoke",

  issueTitle: "Issue an access token",
  nameLabel: "Name",
  nameHelp: "A name that tells you where it is used (e.g. Claude Code). Up to 40 characters",
  scopeLabel: "Permissions",
  writeLabel: "Also allow writing (create event drafts)",
  writeHelp:
    "The AI will be able to create event drafts (it does not publish them). The AI may create drafts on its own. We recommend starting with read only.",
  expiryLabel: "Expires in",
  expiryDays: "{{n}} days",
  issueRun: "Issue",
  issueFailed: "Could not issue the token. Please try again later.",
  tooManyTokens:
    "You can have up to {{max}} active tokens. Revoke a token you no longer use, then issue a new one.",

  issuedTitle: "Token issued",
  issuedOnce:
    "Once you close this screen, the token will never be shown again. Copy it now and paste it into your Claude settings.",
  tokenLabel: "Access token",
  copy: "Copy",
  claudeCodeTitle: "Use with Claude Code",
  claudeCodeHelp: "Run this command in your terminal.",
  claudeAiTitle: "Use with claude.ai / Claude Desktop",
  claudeAiSteps:
    "Open Customize → Connectors → Add custom connector, enter the URL below, and choose \"No sign-in\" for Authentication. Under Request headers, add the name \"authorization\" with the \"Bearer …\" value below.",
  claudeAiNoHeaders:
    "If the Request headers field does not appear, your organization cannot use it yet. Please use Claude Code instead.",
  mcpUrlLabel: "URL",
  headerValueLabel: "Value for authorization",
  issuedDone: "Close",

  revokeTitle: "Revoke this token?",
  revokeBody:
    "\"{{name}}\" ({{prefix}}…) will be revoked. AI assistants using this token will stop working immediately. This cannot be undone.",
  revokeRun: "Revoke",
  revokeFailed: "Could not revoke the token. Please try again later.",
};

export const accessTokens = { ja, en };
