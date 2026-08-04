import { z } from "zod";

/** 監査ログに記録する重要操作の種類 (#248) */
export const AUDIT_ACTIONS = [
  "account_merge",
  "account_delete",
  "identity_takeover",
  "chat_channel_reset",
  "admin_setting_change",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 画面表示用の日本語ラベル。未知の値はそのまま表示する */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  account_merge: "アカウント統合",
  account_delete: "退会",
  identity_takeover: "連携の引き取り",
  chat_channel_reset: "チャンネルのリセット",
  admin_setting_change: "運用設定の変更",
};

/** 監査ログ1件。ユーザー行が消えても辿れるよう、実行時点のハンドルを持つ */
export const auditLogSchema = z.object({
  id: z.string(),
  /** AuditAction のいずれか。将来追加された値も表示できるよう string で受ける */
  action: z.string(),
  actorUserId: z.string().nullable(),
  actorHandle: z.string(),
  targetUserId: z.string().nullable(),
  targetHandle: z.string(),
  /** JSON文字列。個人情報（メール・連絡先・本文など）は含めない */
  detail: z.string(),
  createdAt: z.number(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** 監査ログ一覧の1ページあたり件数 */
export const AUDIT_LOG_PAGE_SIZE = 50;

/** GET /api/admin/audit-logs のレスポンス */
export const auditLogsPayloadSchema = z.object({
  logs: z.array(auditLogSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type AuditLogsPayload = z.infer<typeof auditLogsPayloadSchema>;
