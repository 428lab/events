import { z } from "zod";
import { SUPPORTED_LANGUAGES } from "./i18n/languages.js";

/** 通知設定 (#21 PR3, #126 でメール追加) */
export const notificationPrefsSchema = z.object({
  /** フォロー相手がイベントを公開したときの通知 */
  followeeCreated: z.boolean(),
  /** フォロー相手がイベントに参加したときの通知 */
  followeeJoined: z.boolean(),
  /** アプリ内通知をメールでも受け取る（前日リマインダー含む） (#126) */
  emailEnabled: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const updateNotificationPrefsInput = notificationPrefsSchema.partial();
export type UpdateNotificationPrefsInput = z.infer<
  typeof updateNotificationPrefsInput
>;

/** お知らせとメールの言語を覚える (#352, migration 0128)。オーナー決定 2026-11-19（案 A）:
 * 受け取る人が最後に使った画面の言語で送る。設定で選んだ言語があればそちらが優先。
 * - "report": 画面を開いたとき、サーバーの値と違えば送る。設定で選んだ言語は上書きしない
 * - "choose": 設定で言語を選んだ
 * - "auto": 設定で「自動」に戻した（選んだ印を外し、今の画面の言語にする） */
export const LANGUAGE_UPDATE_MODES = ["report", "choose", "auto"] as const;
export type LanguageUpdateMode = (typeof LANGUAGE_UPDATE_MODES)[number];
export const updateLanguageInput = z.object({
  language: z.enum(SUPPORTED_LANGUAGES),
  mode: z.enum(LANGUAGE_UPDATE_MODES),
});
export type UpdateLanguageInput = z.infer<typeof updateLanguageInput>;

/** サーバーが覚えている言語（GET /api/auth/me の noticeLanguage）。null はまだ分からない */
export interface NoticeLanguage {
  language: string | null;
  explicit: boolean;
}
