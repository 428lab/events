import {
  Alert,
  Box,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useIsAdmin } from "../api/hooks.js";
import { useAdminStats } from "../api/analyticsHooks.js";

/** 管理者向け: 全イベント横断のアクセス統計 */
export function AdminStatsPage() {
  const isAdmin = useIsAdmin();
  const { data, isLoading } = useAdminStats(isAdmin);

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  return (
    <Stack spacing={2.5}>
      <Typography variant="h5" fontWeight={700}>
        📊 アクセス統計（全イベント）
      </Typography>

      {isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : (
        <>
          <Card variant="outlined" sx={{ maxWidth: 220 }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                総表示回数
              </Typography>
              <Typography variant="h4" fontWeight={700}>
                {data.totalViews.toLocaleString()}
              </Typography>
            </CardContent>
          </Card>

          {data.events.length === 0 ? (
            <Typography color="text.secondary">
              まだアクセスデータがありません。
            </Typography>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>イベント</TableCell>
                    <TableCell align="right">表示回数</TableCell>
                    <TableCell align="right">ユニーク</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.events.map((e) => (
                    <TableRow key={e.eventId} hover>
                      <TableCell>
                        <RouterLink
                          to={`/events/${e.eventId}/stats`}
                          style={{ color: "inherit" }}
                        >
                          {e.title || "(無題)"}
                        </RouterLink>
                      </TableCell>
                      <TableCell align="right">
                        {e.views.toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        {e.uniques.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
