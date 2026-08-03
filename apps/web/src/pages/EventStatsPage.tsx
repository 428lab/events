import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import BarChartIcon from "@mui/icons-material/BarChart";
import DownloadIcon from "@mui/icons-material/Download";
import FlagIcon from "@mui/icons-material/Flag";
import PollIcon from "@mui/icons-material/Poll";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { EventStats } from "@eventer/shared";
import { surveyValueLabel } from "@eventer/shared";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { api } from "../api/client.js";
import { useEventStats } from "../api/analyticsHooks.js";
import { useSurveyAnswers } from "../api/eventSurveyHooks.js";

/** 流入元ラベルの友好名 */
const SOURCE_LABEL: Record<string, string> = {
  direct: "直接アクセス",
  internal: "サイト内",
  notification: "通知",
  feed: "フィード",
  email: "メール",
  card: "カード",
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

/** 国コード→国旗（リージョナルインジケーター）。不明なら空文字（Flag アイコンで代替） */
function flag(cc: string): string {
  if (cc.length !== 2 || cc === "XX") return "";
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
        <Typography
          variant="h5"
          fontWeight={700}
          sx={{
            flex: 1,
            minWidth: 160,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
          }}
        >
          <BarChartIcon fontSize="medium" />
          アクセス統計
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
            <StatTile label="表示回数 (PV)" value={data.totalViews} />
            <StatTile label="ユニークビジター" value={data.uniqueVisitors} />
            <StatTile label="参加登録数" value={data.totalParticipants} />
          </Stack>

          {data.totalViews === 0 && data.totalParticipants === 0 ? (
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
                  rows={data.countries.map((cn) => {
                    const f = flag(cn.country);
                    return {
                      label: f ? `${f} ${cn.country}` : cn.country,
                      icon: f ? undefined : (
                        <FlagIcon
                          fontSize="inherit"
                          sx={{ verticalAlign: "text-bottom", mr: 0.5 }}
                        />
                      ),
                      value: cn.views,
                    };
                  })}
                />
              </Stack>
            </>
          )}
        </>
      )}

      {/* 事前アンケートの回答一覧 (#152)。質問がある場合のみ表示 */}
      <SurveyAnswersCard eventId={id} enabled={Boolean(eventData) && isStaff} />
    </Stack>
  );
}

const SURVEY_STATUS_LABEL: Record<string, string> = {
  confirmed: "確定",
  waitlist: "キャンセル待ち",
  applied: "抽選申込中",
  lost: "落選",
  canceled: "キャンセル",
};

/** 事前アンケートの回答一覧（staff のみ）。CSV ダウンロードつき */
function SurveyAnswersCard({
  eventId,
  enabled,
}: {
  eventId: string;
  enabled: boolean;
}) {
  const { data } = useSurveyAnswers(eventId, enabled);
  const [reminding, setReminding] = useState(false);
  const [remindResult, setRemindResult] = useState<string | null>(null);
  if (!data || data.questions.length === 0) return null;
  const { questions, rows } = data;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1.5 }}
        >
          <Typography
            variant="h6"
            sx={{ flex: 1, minWidth: 160, display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <PollIcon fontSize="small" />
            アンケート回答
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<NotificationsNoneIcon />}
            disabled={reminding}
            onClick={async () => {
              if (
                !window.confirm(
                  "未回答の確定参加者に「アンケート回答のお願い」通知を送りますか？",
                )
              ) {
                return;
              }
              setReminding(true);
              try {
                const res = await api.post<{ notified: number }>(
                  `/events/${eventId}/survey/remind`,
                );
                setRemindResult(`${res.notified} 人に通知しました`);
              } catch {
                setRemindResult("送信に失敗しました");
              } finally {
                setReminding(false);
              }
            }}
          >
            未回答者にお願い通知
          </Button>
          {/* 同一オリジンの <a> なので cookie 認証のままダウンロードできる */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            component="a"
            href={`/api/events/${eventId}/survey/answers.csv`}
            download
          >
            CSVダウンロード
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          参加登録時のアンケート回答です（スタッフのみ閲覧できます）。
          {remindResult && ` ・ ${remindResult}`}
        </Typography>
        {rows.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            まだ回答がありません。
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>参加者</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>参加状態</TableCell>
                  {questions.map((q) => (
                    <TableCell key={q.id} sx={{ minWidth: 120 }}>
                      {q.question}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {r.user.globalName ?? r.user.username}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {r.memberStatus
                        ? (SURVEY_STATUS_LABEL[r.memberStatus] ?? r.memberStatus)
                        : "未参加"}
                    </TableCell>
                    {questions.map((q) => (
                      <TableCell key={q.id}>
                        {surveyValueLabel(q.qtype, r.answers[q.id] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
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
  // PVと参加数でスケールが大きく違うため、棒の高さは各系列の最大値で正規化
  const maxViews = Math.max(1, ...daily.map((d) => d.views));
  const maxJoins = Math.max(1, ...daily.map((d) => d.joins));
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ mb: 1 }}
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="subtitle2">日別の推移</Typography>
          <LegendDot color="primary.main" label="表示回数 (PV)" />
          <LegendDot color="secondary.main" label="参加登録" />
        </Stack>
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
              title={`${d.day}  PV:${d.views} / ユニーク:${d.uniques} / 参加:${d.joins}`}
              sx={{
                flex: "1 0 20px",
                minWidth: 20,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.5,
              }}
            >
              {/* PVバー＋参加バーを横並び */}
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
                <Box
                  sx={{
                    width: 8,
                    height: `${(d.views / maxViews) * 110}px`,
                    bgcolor: "primary.main",
                    borderRadius: "2px 2px 0 0",
                    minHeight: d.views > 0 ? 2 : 0,
                  }}
                />
                <Box
                  sx={{
                    width: 8,
                    height: `${(d.joins / maxJoins) * 110}px`,
                    bgcolor: "secondary.main",
                    borderRadius: "2px 2px 0 0",
                    minHeight: d.joins > 0 ? 2 : 0,
                  }}
                />
              </Box>
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

function BarList({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number; icon?: ReactNode }[];
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
                    {r.icon}
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
