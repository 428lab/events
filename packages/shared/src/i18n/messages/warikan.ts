/**
 * 割り勘 (#556) の文言。設計は docs/warikan.md §3.9 / §3.10。
 *
 * このアプリは送金も金銭の預託もしない（帳簿と受け取り先の掲示だけ）。
 * 文言もそこから外れない。**禁止語の一覧は docs/warikan.md §3.10 の1か所**で、
 * apps/server/test/warikan.test.ts がこのファイルの ja/en 全文を走査して固定する。
 * - 「精算」は見出しには使ってよいが、ボタンに「精算する」は使わない
 * - 例や placeholder に口座を連想させる語を出さない
 */
const ja = {
  /** 見出し・導線 */
  title: "割り勘",
  openPage: "割り勘を開く",
  deletedUser: "退会済みユーザー",

  /** 免責（常に表示・閉じられない。1行に畳む） */
  disclaimer: "お金のやりとりは当事者どうしで行います。このアプリはお金を預かりません。",
  disclaimerMore: "詳しく",
  disclaimerDetail:
    "このアプリが記録するのは、誰が何にいくら立て替え、誰が誰にいくら返すかという帳簿と、受け取り先の表示だけです。お金を受け取ったり、預かったり、送ったりはしません。受け取り先はリンクを開くだけで、アプリの中で支払いの画面は出しません。",

  /** あなたの精算 */
  mySettlements: "あなたの精算",
  payTo: "{{name}} さんに {{amount}}",
  receiveFrom: "{{name}} さんから {{amount}}",
  payToAction: "{{name}} さんに {{amount}} 支払う",
  receiveFromAction: "{{name}} さんから {{amount}} 受け取る",
  moreRows: "ほか {{n}} 件",
  groupPay: "あなたが支払う（{{n}}件・合計 {{amount}}）",
  groupReceive: "あなたが受け取る（{{n}}件・合計 {{amount}}）",
  copyAmount: "金額をコピー",
  copied: "コピーしました",
  breakdown: "内訳",
  breakdownYourExpense: "{{title}}（あなたの立替）",
  breakdownTotal: "= {{amount}}",
  noPayoutMethod:
    "受け取り先が登録されていません。振込先は相手から個別に聞いてください。このアプリには書かないでください。",
  counterpartDeleted: "退会済みのため精算できません",
  registerPayout: "受け取り先を登録する",
  noSettlements: "あなたの精算はありません",
  allSettled: "精算は完了しています",

  /** 立替の一覧 */
  expenses: "立替の一覧",
  addExpense: "立替を追加",
  noExpenses: "まだ立替はありません",
  enteredBy: "入力: {{name}}",
  shareCount: "{{n}}人で割る",
  shareCountOne: "{{n}}人で割る",
  includesRemainder: "端数 {{amount}} を含む",
  payerAbsorbs: "端数 {{amount}} は立替者が持ちます",
  remainderRule: "割り切れない端数は、立て替えた人が持ちます。",
  paidBy: "立替: {{name}}",
  deleteExpenseConfirm: "この立替を削除しますか？",

  /** 全員の収支 */
  balances: "全員の収支",
  scrollHint: "横にスクロールできます",
  colName: "名前",
  colPaid: "立て替えた",
  colOwed: "負担",
  colNet: "差引",
  netReceive: "{{amount}} 受け取る",
  netPay: "{{amount}} 支払う",
  netZero: "なし",

  /** 自分の受け取り先 */
  payoutHeading: "自分の受け取り先",
  payoutCaption: "あなたにお金を返す人に表示されます",
  kindUrl: "受け取り用リンク",
  kindLightning: "Lightning アドレス",
  kindUrlHelp: "PayPay・Kyash などの受け取り用リンク",
  kindLightningHelp: "Lightning ウォレットのアドレス",
  payoutValueUrl: "https:// から始まるリンク",
  payoutValueLightning: "LN アドレスまたは LNURL",
  addPayout: "受け取り先を追加",
  noBankNote: "銀行口座はこのアプリに保存できません。",
  noPayouts: "まだ登録していません",
  payoutSaved: "保存しました",
  deletePayoutConfirm: "この受け取り先を削除しますか？",

  /** 受け取り先の表示 */
  openLink: "リンクを開く",
  openWallet: "ウォレットで開く",
  copyAddress: "アドレスをコピー",
  showQr: "QRを表示",
  satsNote: "金額の記録は円のみです。送る sat の額はご自身で決めてください。",

  /** 立替フォーム */
  formNew: "立替を追加",
  formEdit: "立替を編集",
  amount: "金額（円）",
  content: "内容",
  chipVenue: "会場費",
  chipParty: "打ち上げ",
  chipSupplies: "備品",
  chipTransport: "交通費",
  payer: "払った人",
  payerSearch: "名前で絞り込む",
  me: "自分",
  splitWith: "割る人",
  presetAll: "全員",
  presetAttended: "出席した人",
  perPerson: "{{n}} 人・1人あたり約 {{amount}}",
  perPersonOne: "{{n}} 人・1人あたり約 {{amount}}",
  details: "詳細",
  spentOn: "日付",
  note: "メモ",
  notePlaceholder: "3次会の分",
  noteHelp: "振込先はここに書かないでください",
  weight: "重み",
  weightHelp: "アカウントの無い同伴者の分は、連れてきた人の重みを 2 にしてください。",
  saved: "保存しました",
  addAnother: "もう1件入力する",
  noSelectable: "割る人を1人以上選んでください",

  /** サーバーのエラーごとの案内（§3.8.2） */
  errorInvalidParty: "割り勘に加えられない人が含まれています。参加が確定した人を選んでください。",
  errorTooManyExpenses: "立替の件数が上限に達しています。",
  errorAccessChanged: "参加の状態が変わったため保存できませんでした。画面を読み込み直してください。",
  errorInvalidInput: "入力内容を確かめてください。",
} as const;

const en: Record<keyof typeof ja, string> = {
  title: "Split costs",
  openPage: "Open split costs",
  deletedUser: "Deleted user",

  disclaimer: "Money is exchanged directly between the people involved. This app never holds money.",
  disclaimerMore: "Details",
  disclaimerDetail:
    "This app only keeps a ledger of who paid how much for what and who owes whom, and shows where people want to be paid. It never receives, holds or sends money. Payment destinations only open as links, and no payment screen is shown inside the app.",

  mySettlements: "Your settlements",
  payTo: "To {{name}}: {{amount}}",
  receiveFrom: "From {{name}}: {{amount}}",
  payToAction: "Pay {{name}} {{amount}}",
  receiveFromAction: "Receive {{amount}} from {{name}}",
  moreRows: "{{n}} more",
  groupPay: "You pay ({{n}}, {{amount}} in total)",
  groupReceive: "You receive ({{n}}, {{amount}} in total)",
  copyAmount: "Copy amount",
  copied: "Copied",
  breakdown: "Breakdown",
  breakdownYourExpense: "{{title}} (you paid)",
  breakdownTotal: "= {{amount}}",
  noPayoutMethod:
    "No payment destination is registered. Ask them directly where to send it. Please do not write it in this app.",
  counterpartDeleted: "This account was deleted, so it cannot be settled",
  registerPayout: "Add where you get paid",
  noSettlements: "Nothing for you to settle",
  allSettled: "You are all settled",


  expenses: "Expenses",
  addExpense: "Add expense",
  noExpenses: "No expenses yet",
  enteredBy: "Entered by {{name}}",
  shareCount: "Split among {{n}} people",
  shareCountOne: "Split among {{n}} person",
  includesRemainder: "Includes {{amount}} left over",
  payerAbsorbs: "The payer covers the {{amount}} left over",
  remainderRule: "Any amount that does not divide evenly is covered by the person who paid.",
  paidBy: "Paid by {{name}}",
  deleteExpenseConfirm: "Delete this expense?",

  balances: "Everyone's totals",
  scrollHint: "Scroll sideways to see more",
  colName: "Name",
  colPaid: "Paid",
  colOwed: "Share",
  colNet: "Net",
  netReceive: "Receives {{amount}}",
  netPay: "Pays {{amount}}",
  netZero: "None",


  payoutHeading: "Where you get paid",
  payoutCaption: "Shown to people who owe you",
  kindUrl: "Payment link",
  kindLightning: "Lightning address",
  kindUrlHelp: "A link for getting paid, such as PayPay or Kyash",
  kindLightningHelp: "The address of your Lightning wallet",
  payoutValueUrl: "Link starting with https://",
  payoutValueLightning: "LN address or LNURL",
  addPayout: "Add",
  noBankNote: "Bank accounts cannot be saved in this app.",
  noPayouts: "Nothing registered yet",
  payoutSaved: "Saved",
  deletePayoutConfirm: "Delete this destination?",

  openLink: "Open link",
  openWallet: "Open in wallet",
  copyAddress: "Copy address",
  showQr: "Show QR",
  satsNote: "Amounts are recorded in yen only. Decide the amount of sats to send yourself.",

  formNew: "Add expense",
  formEdit: "Edit expense",
  amount: "Amount (JPY)",
  content: "What for",
  chipVenue: "Venue",
  chipParty: "After-party",
  chipSupplies: "Supplies",
  chipTransport: "Travel",
  payer: "Paid by",
  payerSearch: "Filter by name",
  me: "Me",
  splitWith: "Split among",
  presetAll: "Everyone",
  presetAttended: "Attended",
  perPerson: "{{n}} people, about {{amount}} each",
  perPersonOne: "{{n}} person, about {{amount}} each",
  details: "Details",
  spentOn: "Date",
  note: "Note",
  notePlaceholder: "For the second round",
  noteHelp: "Do not write where to send money here",
  weight: "Weight",
  weightHelp: "For a companion without an account, set the weight of the person who brought them to 2.",
  saved: "Saved",
  addAnother: "Add another",
  noSelectable: "Choose at least one person to split among",

  errorInvalidParty: "Someone who cannot be included was selected. Choose confirmed participants.",
  errorTooManyExpenses: "The maximum number of expenses has been reached.",
  errorAccessChanged: "Your participation changed, so this could not be saved. Please reload the page.",
  errorInvalidInput: "Please check what you entered.",
};

export const warikan = { ja, en };
