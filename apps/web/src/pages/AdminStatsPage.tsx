import { useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import BarChartIcon from "@mui/icons-material/BarChart";
import { Link as RouterLink } from "react-router-dom";
import type { AdminStats } from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import { useAdminStats } from "../api/analyticsHooks.js";

const RANGES: { label: string; days: number | null }[] = [
  { label: "7日", days: 7 },
  { label: "30日", days: 30 },
  { label: "90日", days: 90 },
  { label: "全期間", days: null },
];

/** 管理者向け: 全イベント横断のアクセス統計 */
export function AdminStatsPage() {
  const isAdmin = useIsAdmin();
  const [range, setRange] = useState<number | null>(30);
  const [showViews, setShowViews] = useState(true);
  const [showJoins, setShowJoins] = useState(true);
  const { data, isLoading } = useAdminStats(range, isAdmin);

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  return (
    <Stack spacing={2.5}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <BarChartIcon fontSize="medium" />
        アクセス統計（全イベント）
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={range ?? "all"}
        onChange={(_e, v) => v !== null && setRange(v === "all" ? null : v)}
      >
        {RANGES.map((r) => (
          <ToggleButton key={r.label} value={r.days ?? "all"}>
            {r.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {isLoading || !data ? (
        <Typography>読み込み中…</Typography>
      ) : (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <SummaryTile label="総表示回数 (PV)" value={data.totalViews} />
            <SummaryTile label="総参加登録数" value={data.totalParticipants} />
          </Stack>

          <TrendChart
            daily={data.daily}
            showViews={showViews}
            showJoins={showJoins}
            onToggleViews={() => setShowViews((v) => !v)}
            onToggleJoins={() => setShowJoins((v) => !v)}
          />

          {data.events.length === 0 ? (
            <Typography color="text.secondary">
              この期間のアクセスデータはありません。
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

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 160 }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" fontWeight={700}>
          {value.toLocaleString()}
        </Typography>
      </CardContent>
    </Card>
  );
}

function TrendChart({
  daily,
  showViews,
  showJoins,
  onToggleViews,
  onToggleJoins,
}: {
  daily: AdminStats["daily"];
  showViews: boolean;
  showJoins: boolean;
  onToggleViews: () => void;
  onToggleJoins: () => void;
}) {
  const maxViews = Math.max(1, ...daily.map((d) => d.views));
  const maxJoins = Math.max(1, ...daily.map((d) => d.joins));
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ mb: 1 }}
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 120 }}>
            日別の推移（全イベント合算）
          </Typography>
          <FormControlLabel
            control={
              <Switch size="small" checked={showViews} onChange={onToggleViews} />
            }
            label={<SeriesLabel color="primary.main" text="表示回数 (PV)" />}
          />
          <FormControlLabel
            control={
              <Switch size="small" checked={showJoins} onChange={onToggleJoins} />
            }
            label={<SeriesLabel color="secondary.main" text="参加登録" />}
          />
        </Stack>
        {daily.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            データなし
          </Typography>
        ) : (
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-end",
              gap: 0.75,
              height: 150,
              overflowX: "auto",
            }}
          >
            {daily.map((d) => (
              <Box
                key={d.day}
                title={`${d.day}  PV:${d.views} / 参加:${d.joins}`}
                sx={{
                  flex: "1 0 20px",
                  minWidth: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: "2px",
                    height: 110,
                    width: "100%",
                  }}
                >
                  {showViews && (
                    <Box
                      sx={{
                        width: 8,
                        height: `${(d.views / maxViews) * 110}px`,
                        bgcolor: "primary.main",
                        borderRadius: "2px 2px 0 0",
                        minHeight: d.views > 0 ? 2 : 0,
                      }}
                    />
                  )}
                  {showJoins && (
                    <Box
                      sx={{
                        width: 8,
                        height: `${(d.joins / maxJoins) * 110}px`,
                        bgcolor: "secondary.main",
                        borderRadius: "2px 2px 0 0",
                        minHeight: d.joins > 0 ? 2 : 0,
                      }}
                    />
                  )}
                </Box>
                <Typography
                  sx={{ fontSize: 9, color: "text.secondary", whiteSpace: "nowrap" }}
                >
                  {d.day.slice(5)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function SeriesLabel({ color, text }: { color: string; text: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: color }} />
      <Typography variant="caption">{text}</Typography>
    </Stack>
  );
}
