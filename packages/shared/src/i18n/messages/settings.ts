/**
 * アカウント設定まわりの文言 (#354, #357)。
 *
 * #354 で入った表示言語に加えて、#357 でプロフィール・通知設定・ログイン方法
 * （連携）・アカウント統合・退会・退会からの復帰画面を足した。
 *
 * 言語そのものの呼び名（日本語 / English）はここには置かない。どの言語で
 * 表示しても同じ綴りで出すので `LANGUAGE_NAMES`（languages.ts）が出所。
 * ログイン方法の名前（Google / Discord / Nostr）も同じ理由でここには無い
 * （`apps/web/src/lib/providers.ts` の `providerLabel`）。
 *
 * `linkError` は**サーバーが返すコードで引く表**なので独立した名前空間にして
 * ある（`role` / `venue` / `notificationType` と同じ形）。キーはコードその
 * ものなので camelCase ではなく snake_case で、知らないコードは `default` に
 * 落ちる。
 */
const ja = {
  languageTitle: "表示言語",
  languageDescription:
    "画面の表示言語を選べます。選んだ言語はこの端末にだけ残り、ほかの端末には影響しません。",
  languageAuto: "自動",
  languageAutoDescription: "「自動」はブラウザの言語に合わせます。",

  /** アカウント設定ページの見出し */
  accountTitle: "アカウント設定",

  /** プロフィール（表示名・ユーザー名）カード */
  profileTitle: "プロフィール",
  profileUrl: "プロフィールURL: {{path}}",
  displayNameLabel: "表示名",
  displayNameHelp: "イベントやチャットで表示される名前です",
  usernameLabel: "ユーザー名（ハンドル）",
  usernameHelp: "プロフィールURLに使われます",
  usernameInvalidHelp:
    "半角英数字と _ . - スペースのみ（前後スペース不可）、2〜32文字",
  displayNameSaved: "表示名を変更しました",
  usernameSaved: "ユーザー名を変更しました",
  saveFailed: "変更に失敗しました",
  usernameTaken: "このユーザー名は既に使われています",
  usernameInvalidChars:
    "使用できない文字が含まれています（半角英数字と _ . - スペースのみ、前後・連続スペース不可）",

  /** 通知設定カード */
  notificationsTitle: "通知設定",
  notificationsDescription: "フォローしている相手の活動を通知欄に表示します。",
  notifyFolloweeCreated: "フォロー相手がイベントを公開したとき",
  notifyFolloweeJoined: "フォロー相手がイベントに参加したとき",
  notifyEmail: "メール通知（通知と参加イベントの前日リマインダー）",
  emailNotLinked:
    "メール通知には Google / GitHub / Discord のログイン連携が必要です。下の「ログイン方法（連携）」から連携すると利用できます。",
  emailRecipient: "送信先: {{email}}",

  /** ログイン方法（連携）カード */
  loginMethodsTitle: "ログイン方法（連携）",
  loginMethodsDescription:
    "複数のログイン方法を連携できます。そのログイン方法だけで使っている未利用の別アカウントがある場合は、連携がこちらへ引き継がれます（利用実績のあるアカウントからは引き継げません。その場合は「アカウント統合」をお使いください）。",
  linked: "連携済み",
  unlink: "解除",
  linkChecking: "確認中…",
  link: "連携する",
  nostrExtensionMissing: "NIP-07 対応拡張（Alby、nos2x など）が見つかりません。",
  nostrLinkFailed: "Nostr 連携に失敗しました。",
  lastLoginMethodNotice:
    "ログイン方法は最低1つ必要です（最後の1つは解除できません）。",
  linkFailedTitle: "連携できませんでした",

  /** アカウント統合カード */
  mergeTitle: "アカウント統合",
  mergeDescription:
    "誤って別のアカウントを作ってしまった場合に、2つのアカウントを1つにまとめられます。まとめたい片方のアカウントでログインして統合コードを発行し、もう片方のアカウントでそのコードを入力してください。",
  mergeStep1: "1. 統合コードを発行する",
  mergeStep1Description:
    "コードの有効期限は15分・1回だけ使えます。発行したら、もう一方のアカウントでログインし直して入力してください。",
  mergeCodeWarning:
    "このコードは絶対に他人に教えないでください。コードを知られると、アカウントのすべてのデータを他人のアカウントに統合（奪取）されます。運営がコードを尋ねることはありません。",
  mergeIssueCode: "統合コードを発行",
  mergeIssueFailed: "統合コードの発行に失敗しました。",
  mergeCopy: "コピー",
  mergeCopied: "コピーしました",
  mergeStep2: "2. コードを入力して統合する",
  mergeCodeLabel: "統合コード",
  mergeKeepLabel:
    "残すアカウント（ハンドル・プロフィール・表示名はこちらが基準になります）",
  mergeKeepMe: "いまログインしているアカウント",
  mergeKeepOther: "コードを発行したアカウント",
  mergeKeepNotice:
    "参加履歴・作成したイベントなどのデータは、残すアカウントへすべて引き継がれます（両方が同じイベントに参加している場合など、重複する記録は残す側を優先して1つにまとめます。スタッフ権限は引き継がれます）。「コードを発行したアカウント」を残した場合は、いまのアカウントが削除されるため、いったんログイン画面に戻ります。残したアカウントで改めてログインしてください。",
  mergeRun: "統合する",
  mergeSameAccountError:
    "いまログインしているアカウント自身のコードです。もう一方のアカウントで発行したコードを入力してください。",
  mergeCodeInvalidError:
    "統合コードが正しくないか、期限切れ・使用済みです。もう一方のアカウントでコードを発行し直してください。",
  mergeConfirmTitle: "アカウントを統合しますか？",
  mergeConfirmBody:
    "この操作は取り消せません。もう一方のアカウントは削除され、そのデータは残すアカウントへ移動します。",
  mergeConfirmKeepOtherNote:
    "いまログインしているアカウントが削除されるため、実行後はログイン画面に戻ります。",
  mergeConfirmRun: "統合を実行",

  /** 退会カード。猶予期間は環境で変わるので {{grace}} で受ける */
  deleteTitle: "退会",
  /** 猶予期間の表し方。単数と複数でキーを分けてあるのは、英語で "1 days" に
   *  ならないようにするため。**どちらを使うかは数だけで決まり、画面は言語を知らない**
   *  （日本語はどちらも同じ綴り） */
  graceDay: "{{n}}日",
  graceDays: "{{n}}日",
  graceMinute: "{{n}}分",
  graceMinutes: "{{n}}分",
  deleteGraceNotice:
    "退会するとアカウントはすぐに利用できなくなり、他の利用者からも見えなくなります。{{grace}}以内に同じログイン方法でログインすると復帰できます。{{grace}}経過後は完全に削除され、復元できません。",
  deleteBulletLogout:
    "退会するとすぐにログアウトされ、プロフィール・参加者一覧・チャットの表示など、他の利用者から見える場所には表示されなくなります",
  deleteBulletPurge: "{{grace}}経過後に、以下のとおりデータが完全に削除されます",
  deleteBulletKeptContent:
    "作成したイベント・コミュニティ・会場・イベントのたまごは、参加者の履歴や予定を守るため「退会済みユーザー」名義で残ります",
  deleteBulletActivity:
    "参加履歴・いいね・コメント・フォロー・通知などの活動記録は削除されます",
  deleteBulletMedia: "スライド・配信セット・BGM・投稿した写真は削除されます",
  deleteBulletChat: "イベントチャットの発言は表示されなくなります",
  deleteBulletNewAccount:
    "完全削除の後に再度ログインした場合は新しいアカウントになり、以前のデータは戻せません",
  deleteAgree: "上記の内容を理解し、退会に同意します",
  deleteButton: "退会する",
  deleteFailed: "退会に失敗しました。時間をおいて再度お試しください。",
  deleteConfirmTitle: "本当に退会しますか？",
  deleteConfirmBody:
    "アカウントはすぐに利用できなくなり、実行後はログイン画面に戻ります。{{grace}}以内に同じログイン方法でログインすれば復帰できますが、{{grace}}経過後は完全に削除され、元に戻すことはできません。",
  deleteConfirmRun: "退会を実行",

  /** 退会からの復帰画面。日時は Intl が組み立てたものを {{date}} で受ける */
  restoreTitle: "このアカウントは退会手続き中です",
  restoreAppliedAt:
    "@{{handle}} は {{date}} に退会を申請しました。現在は他の利用者から見えない状態になっています。",
  restoreExpired:
    "復帰できる期間（{{date}}まで）を過ぎています。このアカウントと活動記録は間もなく完全に削除されます。引き続きご利用いただく場合は、あらためて新規にログインしてください。",
  restoreDeadline:
    "{{date}} を過ぎるとアカウントと活動記録は完全に削除され、復元できなくなります。",
  restorePrompt:
    "退会を取り消して、これまでの参加履歴・フォロー・作成したコンテンツをそのまま使い続けますか？",
  restoreButton: "復帰する",
  restoreFailed: "復帰に失敗しました。時間をおいて再度お試しください。",
  restoreDeleteAnyway: "このまま退会する（ログアウト）",
} as const;

const en: Record<keyof typeof ja, string> = {
  languageTitle: "Display language",
  languageDescription:
    "Choose the language of the interface. Your choice stays on this device only and does not affect your other devices.",
  languageAuto: "Automatic",
  languageAutoDescription: "“Automatic” follows your browser’s language.",

  accountTitle: "Account settings",

  profileTitle: "Profile",
  profileUrl: "Profile URL: {{path}}",
  displayNameLabel: "Display name",
  displayNameHelp: "The name shown on events and in chat",
  usernameLabel: "Username (handle)",
  usernameHelp: "Used in your profile URL",
  usernameInvalidHelp:
    "Letters, digits, and _ . - and spaces only (no leading or trailing space), 2–32 characters",
  displayNameSaved: "Display name updated",
  usernameSaved: "Username updated",
  saveFailed: "Could not save the change",
  usernameTaken: "That username is already taken",
  usernameInvalidChars:
    "Contains characters that cannot be used (letters, digits, and _ . - and spaces only; no leading, trailing, or repeated spaces)",

  notificationsTitle: "Notifications",
  notificationsDescription:
    "Show activity from the people you follow in your notifications.",
  notifyFolloweeCreated: "Someone you follow publishes an event",
  notifyFolloweeJoined: "Someone you follow joins an event",
  notifyEmail:
    "Email notifications (notices, plus a reminder the day before events you join)",
  emailNotLinked:
    "Email notifications need a Google, GitHub, or Discord login. Link one under “Login methods” below to turn them on.",
  emailRecipient: "Sent to: {{email}}",

  loginMethodsTitle: "Login methods",
  loginMethodsDescription:
    "You can link more than one login method. If another account uses only that login method and has never been active, its link is transferred here (it cannot be transferred from an account that has been used — use “Merge accounts” for that).",
  linked: "Linked",
  unlink: "Unlink",
  linkChecking: "Checking…",
  link: "Link",
  nostrExtensionMissing:
    "No NIP-07 compatible extension (Alby, nos2x, and the like) was found.",
  nostrLinkFailed: "Could not link your Nostr key.",
  lastLoginMethodNotice:
    "You need at least one login method (the last one cannot be unlinked).",
  linkFailedTitle: "Could not link",

  mergeTitle: "Merge accounts",
  mergeDescription:
    "If you created a second account by mistake, you can merge the two into one. Sign in to one of them, issue a merge code, then enter that code while signed in to the other.",
  mergeStep1: "1. Issue a merge code",
  mergeStep1Description:
    "A code is valid for 15 minutes and can be used once. After issuing it, sign in with the other account and enter it there.",
  mergeCodeWarning:
    "Never share this code with anyone. Anyone who knows it can merge (take over) all of your account’s data into theirs. We will never ask you for it.",
  mergeIssueCode: "Issue a merge code",
  mergeIssueFailed: "Could not issue a merge code.",
  mergeCopy: "Copy",
  mergeCopied: "Copied",
  mergeStep2: "2. Enter a code and merge",
  mergeCodeLabel: "Merge code",
  mergeKeepLabel:
    "Account to keep (its handle, profile, and display name are the ones that remain)",
  mergeKeepMe: "The account I am signed in to",
  mergeKeepOther: "The account that issued the code",
  mergeKeepNotice:
    "Everything else — your participation history, the events you created, and so on — moves to the account you keep (where records overlap, for example if both accounts joined the same event, they are combined into one and the kept account wins; organizer permissions are carried over). If you keep “the account that issued the code”, the account you are signed in to is deleted, so you will be sent back to the login screen. Sign in again with the account you kept.",
  mergeRun: "Merge",
  mergeSameAccountError:
    "That is the code for the account you are signed in to. Enter the code issued by the other account.",
  mergeCodeInvalidError:
    "That merge code is wrong, expired, or already used. Issue a new one from the other account.",
  mergeConfirmTitle: "Merge these accounts?",
  mergeConfirmBody:
    "This cannot be undone. The other account is deleted and its data moves to the account you keep.",
  mergeConfirmKeepOtherNote:
    "The account you are signed in to will be deleted, so you will be sent back to the login screen.",
  mergeConfirmRun: "Merge accounts",

  deleteTitle: "Delete account",
  graceDay: "{{n}} day",
  graceDays: "{{n}} days",
  graceMinute: "{{n}} minute",
  graceMinutes: "{{n}} minutes",
  deleteGraceNotice:
    "Once you leave, your account stops working straight away and is hidden from other people. You can come back by signing in with the same login method within {{grace}}. After {{grace}} it is deleted for good and cannot be restored.",
  deleteBulletLogout:
    "You are signed out immediately and stop appearing anywhere other people can see you, such as profiles, participant lists, and chat",
  deleteBulletPurge: "After {{grace}}, your data is deleted for good as follows",
  deleteBulletKeptContent:
    "Events, communities, venues, and requests you created stay, credited to “Deleted user”, so that other participants keep their history and plans",
  deleteBulletActivity:
    "Activity records such as participation history, likes, comments, follows, and notifications are deleted",
  deleteBulletMedia:
    "Slides, broadcast sets, background music, and photos you posted are deleted",
  deleteBulletChat: "Your event chat messages stop being shown",
  deleteBulletNewAccount:
    "If you sign in again after the final deletion you get a new account, and your previous data cannot be brought back",
  deleteAgree: "I understand the above and agree to delete my account",
  deleteButton: "Delete my account",
  deleteFailed: "Could not delete the account. Please wait a moment and retry.",
  deleteConfirmTitle: "Really delete your account?",
  deleteConfirmBody:
    "Your account stops working straight away and you will be sent back to the login screen. You can come back by signing in with the same login method within {{grace}}, but after {{grace}} it is deleted for good and cannot be undone.",
  deleteConfirmRun: "Delete account",

  restoreTitle: "This account is being deleted",
  restoreAppliedAt:
    "@{{handle}} asked to delete this account on {{date}}. It is currently hidden from other people.",
  restoreExpired:
    "The period for restoring this account (until {{date}}) has passed. The account and its activity records will be deleted for good shortly. To keep using the service, please sign in again as a new user.",
  restoreDeadline:
    "After {{date}}, the account and its activity records are deleted for good and can no longer be restored.",
  restorePrompt:
    "Would you like to cancel the deletion and keep using your participation history, follows, and the content you created?",
  restoreButton: "Restore this account",
  restoreFailed: "Could not restore the account. Please wait a moment and retry.",
  restoreDeleteAnyway: "Leave anyway (sign out)",
};

export const settings = { ja, en };

/**
 * ログイン方法の連携が断られた理由 (#238, #245, #250)。
 *
 * キーは**サーバーが返すコードそのもの**。知らないコードは `default` に落ちる
 * （もとの実装も `account_in_use` / `account_deleted` 以外はすべてこの文言だった）。
 */
const linkErrorJa = {
  default:
    "そのアカウントは他のログイン方法を持つ別ユーザーに連携されています。統合したい場合は、先に相手側アカウントで連携を解除してください。",
  /** 引き取り拒否 (#238): 相手アカウントに利用実績がある場合 */
  account_in_use:
    "そのログイン方法は、利用実績のある別のアカウントに連携されています。そちらのアカウントでログインし直してから、逆にこちらのログイン方法を連携してください。",
  /** 引き取り拒否 (#250): 相手アカウントが退会手続き中（猶予期間）の場合 */
  account_deleted:
    "そのログイン方法は、退会手続き中のアカウントに連携されています。そちらのアカウントでログインすると復帰できます。完全に削除されたあとであれば、あらためて連携できます。",
} as const;

const linkErrorEn: Record<keyof typeof linkErrorJa, string> = {
  default:
    "That account is already linked to a different user who has other login methods. To merge them, unlink it from that account first.",
  account_in_use:
    "That login method is linked to another account that has been used. Sign in with that account instead, and link this login method from there.",
  account_deleted:
    "That login method is linked to an account that is being deleted. Sign in with that account to restore it. Once it has been deleted for good, you can link the login method again.",
};

export const linkError = { ja: linkErrorJa, en: linkErrorEn };
