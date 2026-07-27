import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { EventStats } from "@eventer/shared";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { useEventStats } from "../api/analyticsHooks.js";

/** 流入元ラベルの友好名 */
const SOURCE_LABEL: Record<string, string> = {
  direct: "直接アクセス",
  internal: "サイト内",
  "t.co": "X (Twitter)",
  "twitter.com": "X (Twitter)",
  "x.com": "X (Twitter)",
  "l.facebook.com": "Facebook",
  "facebook.com": "Facebook",
  "lm.facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "l.instagram.com": "Instagram",
  "google.com": "Google",
  "www.google.com": "Google",
  "nostr.band": "Nostr",
  "yabu.me": "Nostr",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

/** 国コード→絵文字フラグ */
function flag(cc: string): string {
  if (cc.length !== 2 || cc === "XX") return "🏳️";
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

const RANGES: { label: string; days: number | null }[] = [
  { label: "7日", days: 7 },
  { label: "30日", days: 30 },
  { label: "全期間", days: null },
];

export function EventStatsPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const [range, setRange] = useState<number | null>(30);
  const isStaff = eventData?.myRole === "staff" || isAdmin;
  const { data, isLoading, isError } = useEventStats(id, range, Boolean(eventData) && isStaff);

  if (eventData && !isStaff) {
    return <Alert severity="warning">アクセス統計はスタッフ専用です。</Alert>;
  }
  if (isError) return <Alert severity="info">統計を取得できませんでした。</Alert>;

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1, minWidth: 160 }}>
          📊 アクセス統計
        </Typography>
        <Button size="small" component={RouterLink} to={`/events/${id}`}>
          ← イベントへ戻る
        </Button>
      </Stack>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={range}
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
          {/* サマリ */}
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <StatTile label="表示回数" value={data.totalViews} />
            <StatTile label="ユニークビジター" value={data.uniqueVisitors} />
          </Stack>

          {data.totalViews === 0 ? (
            <Typography color="text.secondary">
              まだアクセスがありません。公開してシェアすると、ここに流入元や推移が表示されます。
            </Typography>
          ) : (
            <>
              <DailyChart daily={data.daily} />
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <BarList
                  title="流入元"
                  rows={data.sources.map((s) => ({
                    label: sourceLabel(s.source),
                    value: s.views,
                  }))}
                />
                <BarList
                  title="国・地域"
                  rows={data.countries.map((cn) => ({
                    label: `${flag(cn.country)} ${cn.country}`,
                    value: cn.views,
                  }))}
                />
              </Stack>
            </>
          )}
        </>
      )}
    </Stack>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 140 }}>
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

function DailyChart({ daily }: { daily: EventStats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.views));
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>
          日別の表示回数
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: 0.5,
            height: 140,
            overflowX: "auto",
          }}
        >
          {daily.map((d) => (
            <Box
              key={d.day}
              title={`${d.day}: ${d.views}回 / ${d.uniques}人`}
              sx={{
                flex: "1 0 12px",
                minWidth: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.5,
              }}
            >
              <Box
                sx={{
                  width: "100%",
                  height: `${(d.views / max) * 110}px`,
                  bgcolor: "primary.main",
                  borderRadius: "3px 3px 0 0",
                  minHeight: 2,
                }}
              />
              <Typography
                sx={{ fontSize: 9, color: "text.secondary", whiteSpace: "nowrap" }}
              >
                {d.day.slice(5)}
              </Typography>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

function BarList({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card variant="outlined" sx={{ flex: 1 }}>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>
          {title}
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            データなし
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {rows.map((r) => (
              <Box key={r.label}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" noWrap sx={{ mr: 1 }}>
                    {r.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {r.value.toLocaleString()}
                  </Typography>
                </Stack>
                <Box
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: "action.hover",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      width: `${(r.value / max) * 100}%`,
                      height: "100%",
                      bgcolor: "secondary.main",
                    }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
