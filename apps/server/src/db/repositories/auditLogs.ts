import type { AuditAction, AuditLog } from "@eventer/shared";
import { many, one, run } from "../client.js";

/** 監査ログの当事者。退会・統合でユーザー行が消えても辿れるよう
 * 実行時点のハンドル（username）を一緒に控える */
export interface AuditActor {
  id: string;
  handle: string;
}

export interface AuditRecordInput {
  action: AuditAction;
  actor?: AuditActor | null;
  target?: AuditActor | null;
  /** JSON化して detail に入れる。個人情報（メール・連絡先・本文）は入れないこと */
  detail?: Record<string, unknown> | null;
}

interface AuditLogRow {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_handle: string;
  target_user_id: string | null;
  target_handle: string;
  detail: string;
  created_at: number;
}

function toAuditLog(r: AuditLogRow): AuditLog {
  return {
    id: r.id,
    action: r.action,
    actorUserId: r.actor_user_id,
    actorHandle: r.actor_handle,
    targetUserId: r.target_user_id,
    targetHandle: r.target_handle,
    detail: r.detail,
    createdAt: r.created_at,
  };
}

/** 重要操作の監査ログ (#248)。user への FK は張らないので、
 * 統合・退会でユーザー行が消えても記録は残り続ける */
export const auditLogsRepo = {
  async record({
    action,
    actor = null,
    target = null,
    detail = null,
  }: AuditRecordInput): Promise<void> {
    await run(
      `INSERT INTO audit_log
         (id, action, actor_user_id, actor_handle, target_user_id, target_handle, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      action,
      actor?.id ?? null,
      actor?.handle ?? "",
      target?.id ?? null,
      target?.handle ?? "",
      detail ? JSON.stringify(detail) : "",
      Date.now(),
    );
  },

  async list({
    action,
    limit,
    offset,
  }: {
    action?: string;
    limit: number;
    offset: number;
  }): Promise<AuditLog[]> {
    const rows = action
      ? await many<AuditLogRow>(
          `SELECT * FROM audit_log WHERE action = ?
           ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
          action,
          limit,
          offset,
        )
      : await many<AuditLogRow>(
          `SELECT * FROM audit_log
           ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
          limit,
          offset,
        );
    return rows.map(toAuditLog);
  },

  async count({ action }: { action?: string } = {}): Promise<number> {
    const row = action
      ? await one<{ n: number }>(
          "SELECT COUNT(1) AS n FROM audit_log WHERE action = ?",
          action,
        )
      : await one<{ n: number }>("SELECT COUNT(1) AS n FROM audit_log");
    return row?.n ?? 0;
  },
};

/** 記録の失敗で本体処理（統合・退会など）を巻き添えにしないための安全版。
 * ログ自体は失敗を console に残すので、取りこぼしは調査できる */
export async function recordAudit(entry: AuditRecordInput): Promise<void> {
  try {
    await auditLogsRepo.record(entry);
  } catch (e) {
    console.error(`[audit] failed to record ${entry.action}`, e);
  }
}
