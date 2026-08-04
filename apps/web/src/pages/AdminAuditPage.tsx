import { useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  MenuItem,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from "@eventer/shared";
import type { AuditAction, AuditLog } from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useAuditLogs } from "../api/auditHooks.js";
import { formatDateTime } from "../lib/format.js";

/** 未知のアクション名はそのまま表示する（将来追加分でも壊れないように） */
function actionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action as AuditAction] ?? action;
}

/** 当事者の表示。ハンドルが空なら user ID を短縮表示、どちらも無ければ「—」 */
function partyLabel(handle: string, userId: string | null): string {
  if (handle) return handle;
  if (userId) return userId.slice(0, 8);
  return "—";
}

/** detail は JSON文字列。読みやすいよう key=value 形式に整形して表示する */
function detailText(detail: string): string {
  if (!detail) return "";
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" / ");
    }
  } catch {
    // 壊れた JSON はそのまま出す
  }
  return detail;
}

function LogRow({ log }: { log: AuditLog }) {
  const detail = detailText(log.detail);
  return (
    <TableRow hover>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {formatDateTime(log.createdAt)}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {actionLabel(log.action)}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        <Tooltip title={log.actorUserId ?? ""}>
          <span>{partyLabel(log.actorHandle, log.actorUserId)}</span>
        </Tooltip>
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        <Tooltip title={log.targetUserId ?? ""}>
          <span>{partyLabel(log.targetHandle, log.targetUserId)}</span>
        </Tooltip>
      </TableCell>
      <TableCell
        sx={{
          fontFamily: "monospace",
          fontSize: 12,
          wordBreak: "break-all",
          minWidth: 220,
        }}
      >
        {detail}
      </TableCell>
    </TableRow>
  );
}

/** 管理者向け: 重要操作の監査ログ (#248) */
export function AdminAuditPage() {
  const isAdmin = useIsAdmin();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAuditLogs(isAdmin, { action, page });

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <Stack spacing={2.5}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <HistoryIcon fontSize="medium" />
        監査ログ
      </Typography>
      <Typography variant="body2" color="text.secondary">
        アカウント統合・退会・連携の引き取りなど、後から取り消せない重要操作の記録です。
        個人情報（メールアドレスや本文）は記録していません。
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <TextField
              select
              size="small"
              label="操作の種類"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              sx={{ maxWidth: 260 }}
            >
              <MenuItem value="">すべて</MenuItem>
              {AUDIT_ACTIONS.map((a) => (
                <MenuItem key={a} value={a}>
                  {AUDIT_ACTION_LABELS[a]}
                </MenuItem>
              ))}
            </TextField>

            {isLoading || !data ? (
              <Typography>読み込み中…</Typography>
            ) : data.logs.length === 0 ? (
              <Typography color="text.secondary">
                記録はまだありません。
              </Typography>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary">
                  全 {data.total} 件
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>日時</TableCell>
                        <TableCell>アクション</TableCell>
                        <TableCell>実行者</TableCell>
                        <TableCell>対象</TableCell>
                        <TableCell>詳細</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.logs.map((log) => (
                        <LogRow key={log.id} log={log} />
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {pageCount > 1 && (
                  <Box sx={{ display: "flex", justifyContent: "center" }}>
                    <Pagination
                      count={pageCount}
                      page={page}
                      onChange={(_e, p) => setPage(p)}
                      color="primary"
                    />
                  </Box>
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
