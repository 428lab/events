import { useQuery } from "@tanstack/react-query";
import type { AuditLogsPayload } from "@eventer/shared";
import { api } from "./client.js";

/** 監査ログ一覧（app admin のみ） (#248)。action="" で絞り込みなし */
export function useAuditLogs(
  enabled: boolean,
  { action, page }: { action: string; page: number },
) {
  return useQuery({
    queryKey: ["auditLogs", action, page],
    enabled,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (action) params.set("action", action);
      return api.get<AuditLogsPayload>(`/admin/audit-logs?${params}`);
    },
  });
}
