import { useState, type ReactNode } from "react";
import {
  Avatar,
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
import HandshakeOutlinedIcon from "@mui/icons-material/HandshakeOutlined";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EventStats } from "@eventer/shared";
import { surveyValueLabel } from "@eventer/shared";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { api } from "../api/client.js";
import { useEventStats } from "../api/analyticsHooks.js";
import { useSurveyAnswers } from "../api/eventSurveyHooks.js";
import { useMeetRanking } from "../api/eventMeetHooks.js";
import { i18next } from "../i18n/index.js";

/** サイトが自分で付ける流入元の印。文言は辞書にある */
const INTERNAL_SOURCE_KEY: Partial<
  Record<
    string,
    | "staffOps.sourceDirect"
    | "staffOps.sourceInternal"
    | "staffOps.sourceNotification"
    | "staffOps.sourceFeed"
    | "staffOps.sourceEmail"
    | "staffOps.sourceCard"
  >
> = {
  direct: "staffOps.sourceDirect",
  internal: "staffOps.sourceInternal",
  notification: "staffOps.sourceNotification",
  feed: "staffOps.sourceFeed",
  email: "staffOps.sourceEmail",
  card: "staffOps.sourceCard",
};

/** 外部サイトの見せ方。サービス名はどの言語でも同じ綴りなので辞書には置かない */
const SITE_LABEL: Record<string, string> = {
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

/** 知らない流入元はそのまま出す（サーバーが増やしても画面は壊れない） */
const sourceLabel = (s: string): string => {
  const key = INTERNAL_SOURCE_KEY[s];
  return key ? i18next.t(key) : (SITE_LABEL[s] ?? s);
};

/** 国コード→国旗（リージョナルインジケーター）。不明なら空文字（Flag アイコンで代替） */
function flag(cc: string): string {
  if (cc.length !== 2 || cc === "XX") return "";
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

/** 集計する期間。文言そのものではなく翻訳キーを持つ */
const RANGES: {
  labelKey: "staffOps.statsRange7" | "staffOps.statsRange30" | "staffOps.statsRangeAll";
  days: number | null;
}[] = [
  { labelKey: "staffOps.statsRange7", days: 7 },
  { labelKey: "staffOps.statsRange30", days: 30 },
  { labelKey: "staffOps.statsRangeAll", days: null },
];

export function EventStatsPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const [range, setRange] = useState<number | null>(30);
  const isStaff = eventData?.myRole === "staff" || isAdmin;
  const { data, isLoading, isError } = useEventStats(id, range, Boolean(eventData) && isStaff);

  if (eventData && !isStaff) {
    return <Alert severity="warning">{t("staffOps.statsStaffOnly")}</Alert>;
  }
  if (isError) {
    return <Alert severity="info">{t("staffOps.statsLoadFailed")}</Alert>;
  }

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
          {t("eventDetail.stats")}
        </Typography>
        <Button size="small" component={RouterLink} to={`/events/${id}`}>
          {t("staffOps.backToEvent")}
        </Button>
      </Stack>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={range}
        onChange={(_e, v) => v !== null && setRange(v === "all" ? null : v)}
      >
        {RANGES.map((r) => (
          <ToggleButton key={r.days ?? "all"} value={r.days ?? "all"}>
            {t(r.labelKey)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {isLoading || !data ? (
        <Typography>{t("common.loading")}</Typography>
      ) : (
        <>
          {/* サマリ */}
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <StatTile label={t("staffOps.statsViews")} value={data.totalViews} />
            <StatTile
              label={t("staffOps.statsUniques")}
              value={data.uniqueVisitors}
            />
            <StatTile
              label={t("staffOps.statsJoins")}
              value={data.totalParticipants}
            />
          </Stack>

          {data.totalViews === 0 && data.totalParticipants === 0 ? (
            <Typography color="text.secondary">
              {t("staffOps.statsEmpty")}
            </Typography>
          ) : (
            <>
              <DailyChart daily={data.daily} />
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <BarList
                  title={t("staffOps.statsSources")}
                  rows={data.sources.map((s) => ({
                    label: sourceLabel(s.source),
                    value: s.views,
                  }))}
                />
                <BarList
                  title={t("staffOps.statsCountries")}
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
      <MeetRankingCard
        eventId={id}
        enabled={Boolean(eventData) && isStaff}
        // 参加者向けランキング (#418) がオンなら投影ページへの入口も出す
        showScreenLink={eventData?.event.meetRanking !== "off"}
      />
    </Stack>
  );
}

/** 参加状態の見せ方。文言はイベント詳細と同じものを引く（表を2か所に持たない） */
const SURVEY_STATUS_KEY: Partial<
  Record<
    string,
    | "eventDetail.statusConfirmed"
    | "eventDetail.statusWaitlist"
    | "eventDetail.statusApplied"
    | "eventDetail.statusLost"
    | "staffOps.surveyStatusCanceled"
  >
> = {
  confirmed: "eventDetail.statusConfirmed",
  waitlist: "eventDetail.statusWaitlist",
  applied: "eventDetail.statusApplied",
  lost: "eventDetail.statusLost",
  canceled: "staffOps.surveyStatusCanceled",
};

/** 表に無い状態はサーバーの値をそのまま出す */
function surveyStatusLabel(status: string): string {
  const key = SURVEY_STATUS_KEY[status];
  return key ? i18next.t(key) : status;
}

/** 事前アンケートの回答一覧（staff のみ）。CSV ダウンロードつき */
function SurveyAnswersCard({
  eventId,
  enabled,
}: {
  eventId: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
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
            {t("staffOps.surveyTitle")}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<NotificationsNoneIcon />}
            disabled={reminding}
            onClick={async () => {
              if (!window.confirm(t("staffOps.surveyRemindConfirm"))) {
                return;
              }
              setReminding(true);
              try {
                const res = await api.post<{ notified: number }>(
                  `/events/${eventId}/survey/remind`,
                );
                setRemindResult(
                  t(
                    res.notified === 1
                      ? "staffOps.surveyRemindedOne"
                      : "staffOps.surveyReminded",
                    { n: res.notified },
                  ),
                );
              } catch {
                setRemindResult(t("staffOps.surveyRemindFailed"));
              } finally {
                setReminding(false);
              }
            }}
          >
            {t("staffOps.surveyRemind")}
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
            {t("staffOps.surveyCsv")}
          </Button>
          {/* 受付結果＋アンケートを1枚にした名簿（会場提供者にも渡せる） (#154) */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            component="a"
            href={`/api/events/${eventId}/attendance.csv`}
            download
          >
            {t("staffOps.attendanceCsv")}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t("staffOps.surveyNote")}
          {remindResult && `${t("common.dotSeparator")}${remindResult}`}
        </Typography>
        {rows.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            {t("staffOps.surveyEmpty")}
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {t("eventDetail.participantsHeading")}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {t("staffOps.surveyStatusColumn")}
                  </TableCell>
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
                        ? surveyStatusLabel(r.memberStatus)
                        : t("staffOps.surveyNotJoined")}
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
  const { t } = useTranslation();
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
          <Typography variant="subtitle2">{t("staffOps.statsDaily")}</Typography>
          <LegendDot color="primary.main" label={t("staffOps.statsViews")} />
          <LegendDot
            color="secondary.main"
            label={t("staffOps.statsLegendJoins")}
          />
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
              title={t("staffOps.statsDayTooltip", {
                day: d.day,
                views: d.views,
                uniques: d.uniques,
                joins: d.joins,
              })}
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
  const { t } = useTranslation();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card variant="outlined" sx={{ flex: 1 }}>
      <CardContent>
        <Typography variant="subtitle2" gutterBottom>
          {title}
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t("staffOps.statsNoData")}
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

/** 出会い数ランキング（スタッフのみ・景品配布などの運営用） */
function MeetRankingCard({
  eventId,
  enabled,
  showScreenLink,
}: {
  eventId: string;
  enabled: boolean;
  showScreenLink: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useMeetRanking(eventId, enabled);
  if (!data || data.ranking.length === 0) return null;
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h6"
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <HandshakeOutlinedIcon fontSize="small" />
          {t("staffOps.meetRankingTitle")}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {t("staffOps.meetRankingNote")}
        </Typography>
        {showScreenLink && (
          <Button
            size="small"
            component={RouterLink}
            to={`/events/${eventId}/meet-ranking/screen`}
            sx={{ mb: 1 }}
          >
            {t("eventSocial.meetRankingOpenScreen")}
          </Button>
        )}
        {/* 景品の引き換えデスク (#431)。「景品の参考にどうぞ」の行き先 */}
        <Button
          size="small"
          component={RouterLink}
          to={`/events/${eventId}/prize-desk`}
          sx={{ mb: 1 }}
        >
          {t("staffOps.prizeDeskTitle")}
        </Button>
        <Stack spacing={0.75}>
          {data.ranking.map((r, i) => (
            <Stack
              key={r.userId}
              direction="row"
              spacing={1.5}
              alignItems="center"
            >
              <Typography
                variant="body2"
                fontWeight={700}
                sx={{ width: 28, textAlign: "right", color: i < 3 ? "secondary.main" : "text.secondary" }}
              >
                {i + 1}
              </Typography>
              <Avatar src={r.avatarUrl ?? undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                {r.name.charAt(0)}
              </Avatar>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {r.name}
              </Typography>
              <Typography variant="body2" fontWeight={700}>
                {r.count}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
