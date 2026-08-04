import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { AUDIT_LOG_PAGE_SIZE } from "@eventer/shared";
import type { AuditLogsPayload } from "@eventer/shared";
import type { AppEnv } from "../types.js";
import { requireAuth } from "../auth/session.js";
import { isAppAdmin } from "../auth/admin.js";
import { auditLogsRepo } from "../db/repositories/auditLogs.js";

/** 監査ログの閲覧（app admin のみ） (#248) */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAppAdmin(c.get("user"))) return c.json({ error: "forbidden" }, 403);
  await next();
};

export const adminAuditRoutes = new Hono<AppEnv>();
adminAuditRoutes.use("*", requireAuth, requireAdmin);

/** GET /api/admin/audit-logs?action=&page= （1ページ AUDIT_LOG_PAGE_SIZE 件） */
adminAuditRoutes.get("/", async (c) => {
  // action は自由入力を許すが、DB に無い値なら単に0件になるだけ
  const action = (c.req.query("action") ?? "").trim() || undefined;
  const rawPage = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = AUDIT_LOG_PAGE_SIZE;
  const [logs, total] = await Promise.all([
    auditLogsRepo.list({ action, limit, offset: (page - 1) * limit }),
    auditLogsRepo.count({ action }),
  ]);
  const payload: AuditLogsPayload = { logs, total, page, limit };
  return c.json(payload);
});
