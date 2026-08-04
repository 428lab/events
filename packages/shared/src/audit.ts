import { z } from "zod";

/** 監査ログに記録する重要操作の種類 (#248) */
export const AUDIT_ACTIONS = [
  "account_merge",
  /** 猶予期間 (#250) 以前の即時退会。過去ログの表示互換のため定義に残す */
  "account_delete",
  /** 退会リクエスト（猶予期間の開始） (#250) */
  "account_delete_requested",
  /** 猶予期間の経過後に行う完全削除（日次バッチ） (#250) */
  "account_delete_completed",
  /** 猶予期間中のログインによる復帰 (#250) */
  "account_restore",
  "identity_takeover",
  "chat_channel_reset",
  "admin_setting_change",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 画面表示用の日本語ラベル。未知の値はそのまま表示する */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  account_merge: "アカウント統合",
  account_delete: "退会（旧・即時削除）",
  account_delete_requested: "退会の申請",
  account_delete_completed: "退会の完全削除",
  account_restore: "退会の取り消し（復帰）",
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
