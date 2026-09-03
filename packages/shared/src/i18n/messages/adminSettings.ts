/**
 * 管理者向け運用設定画面 (AdminSettingsPage) の文言。
 *
 * 画面本体は現状 ja ハードコードで、ここには #460 で足したリレー要件の
 * 1文だけがある（ページ全体の i18n 化は別 issue のスコープ）。
 * 管理者・スタッフ向け画面なので技術名（NIP-42/NIP-70）をそのまま書いてよい
 * （「UI に技術名を出さない」方針は参加者向け文言のルール）。
 */
const ja = {
  relayRequirements:
    "カスタムリレーは NIP-42（接続認証）と NIP-70（保護イベント）への対応が必須です。対応していないリレーでは、チャンネルの開設や発言の書き込みが拒否されます。",
} as const;

const en: Record<keyof typeof ja, string> = {
  relayRequirements:
    "Custom relays must support NIP-42 (connection auth) and NIP-70 (protected events). Relays without them will reject opening chat rooms and posting messages.",
};

export const adminSettings = { ja, en };
