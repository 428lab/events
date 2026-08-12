import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EVENT_MODES, type EventMode } from "@eventer/shared";
import { useEvent, useEventEntries, useIsAdmin } from "../api/hooks.js";
import {
  useEventState,
  useScoreProgress,
  useScoreSummary,
  useSetMode,
  useSetPresenting,
  useToggleScoringLock,
} from "../api/scoringHooks.js";
import { useAwards } from "../api/awardHooks.js";
import { roleLabel } from "../lib/format.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { UserLink } from "../components/UserLink.js";
import { useEntryUserResolver } from "../lib/entryUser.js";

/** モード名の翻訳キー。**訳した文字列ではなくキーを持つ**ので、
 * 言語を切り替えたときに前の言語のまま残らない。
 * 通常以外はイベント詳細のチップと同じ言い方なので eventDetail から引く */
const MODE_LABEL_KEY = {
  normal: "eventRun.modeNormal",
  presentation: "eventDetail.modePresentation",
  aggregation: "eventDetail.modeAggregation",
  awards: "eventDetail.modeAwards",
} as const satisfies Record<EventMode, string>;

export function ControlPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const { data: state } = useEventState(id);
  const { data: entries } = useEventEntries(id);
  const resolveUser = useEntryUserResolver(id);
  const setMode = useSetMode(id);
  const setPresenting = useSetPresenting(id);
  const toggleLock = useToggleScoringLock(id);

  const isAdmin = useIsAdmin();
  const isStaff = eventData?.myRole === "staff" || isAdmin;
  const { data: summary } = useScoreSummary(id, Boolean(isStaff));
  const { data: progress } = useScoreProgress(id, Boolean(isStaff));
  const { data: awards } = useAwards(id);
  /** 賞の総数（ランキング賞＋特別枠）。英語の単数・複数はこの数だけで決まる */
  const awardTotal = awards ? awards.ranks.length + awards.specials.length : 0;

  if (!eventData || !state || !entries) {
    return <Typography>{t("common.loading")}</Typography>;
  }
  if (!isStaff) {
    return <Alert severity="info">{t("eventRun.controlStaffOnly")}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("eventDetail.control")}
      />
      <Typography variant="h5" fontWeight={700}>
        {t("eventDetail.control")}
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          component={RouterLink}
          to={`/events/${id}/scoring`}
        >
          {t("eventRun.toScoring")}
        </Button>
        {state.mode === "presentation" && (
          <Button
            variant="outlined"
            color="error"
            component={RouterLink}
            to={`/events/${id}/present`}
          >
            {t("eventDetail.toPresentation")}
          </Button>
        )}
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("eventRun.modeHeading")}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {EVENT_MODES.map((m) => (
              <Button
                key={m}
                variant={state.mode === m ? "contained" : "outlined"}
                onClick={() => setMode.mutate(m)}
              >
                {t(MODE_LABEL_KEY[m])}
              </Button>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("eventRun.presentingHeading")}
          </Typography>
          <TextField
            select
            fullWidth
            value={state.presentingEntryId ?? ""}
            onChange={(e) =>
              setPresenting.mutate(e.target.value === "" ? null : e.target.value)
            }
          >
            <MenuItem value="">{t("eventRun.notSelected")}</MenuItem>
            {entries.map((en) => (
              <MenuItem key={en.id} value={en.id}>
                {en.name}
              </MenuItem>
            ))}
          </TextField>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6">
                {t("eventRun.scoringLockHeading")}
              </Typography>
              <Chip
                size="small"
                color={state.scoringLocked ? "error" : "success"}
                label={t(
                  state.scoringLocked
                    ? "eventRun.scoringLockedChip"
                    : "eventRun.scoringOpenChip",
                )}
              />
            </Box>
            <Button
              variant="outlined"
              color={state.scoringLocked ? "success" : "error"}
              onClick={() => toggleLock.mutate()}
            >
              {t(
                state.scoringLocked
                  ? "eventRun.reopenScoring"
                  : "eventRun.closeScoring",
              )}
            </Button>
          </Stack>
          {state.scoringLocked && (
            <Box sx={{ mt: 2 }}>
              <Alert
                severity="success"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    component={RouterLink}
                    to={`/events/${id}/edit`}
                  >
                    {t("eventRun.setWinnersAction")}
                  </Button>
                }
              >
                {t("eventRun.scoringClosedNotice")}
              </Alert>
            </Box>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("eventRun.progressHeading")}
          </Typography>
          {progress?.judges.length === 0 ? (
            <Typography color="text.secondary">
              {t("eventRun.noJudges")}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {progress?.judges.map((j) => (
                <Box key={j.userId}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2">
                      {t("eventRun.judgeNameWithRole", {
                        name: j.name,
                        role: roleLabel(j.role),
                      })}
                    </Typography>
                    <Typography
                      variant="body2"
                      color={j.complete ? "success.main" : "text.secondary"}
                    >
                      {j.filled}/{j.total}
                      {j.complete && (
                        <CheckIcon
                          fontSize="inherit"
                          sx={{ verticalAlign: "text-bottom", ml: 0.5 }}
                        />
                      )}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={j.total > 0 ? (j.filled / j.total) * 100 : 0}
                  />
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("eventRun.summaryHeading")}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("eventRun.teamColumn")}</TableCell>
                {summary?.criteria.map((c) => (
                  <TableCell key={c.id} align="right">
                    {c.name}
                  </TableCell>
                ))}
                <TableCell align="right">{t("eventRun.totalColumn")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary?.entries.map((e) => (
                <TableRow key={e.entryId}>
                  <TableCell>
                    <UserLink
                      username={resolveUser(e.entryId)?.username}
                      name={e.entryName}
                    />
                  </TableCell>
                  {summary.criteria.map((c) => (
                    <TableCell key={c.id} align="right">
                      {e.perCriterion[c.id] ?? 0}
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    <strong>{e.total}</strong>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("eventDetail.modeAwards")}
          </Typography>
          {/* ①②③ は言語で変わらない番号記号。下のチップと対応している */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("eventRun.awardsSteps")}
          </Typography>
          <Stack spacing={2}>
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Chip size="small" label="①" />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                {t(
                  awardTotal === 1
                    ? "eventRun.setWinnersCountOne"
                    : "eventRun.setWinnersCount",
                  { n: awards ? awards.results.length : 0, total: awardTotal },
                )}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                component={RouterLink}
                to={`/events/${id}/edit`}
              >
                {t("eventRun.setWinners")}
              </Button>
            </Stack>

            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Chip size="small" label="②" />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                {t("eventRun.switchToAwardsMode")}
                {state.mode === "awards" && t("eventRun.currentModeSuffix")}
              </Typography>
              <Button
                size="small"
                variant={state.mode === "awards" ? "contained" : "outlined"}
                disabled={state.mode === "awards"}
                onClick={() => setMode.mutate("awards")}
              >
                {t("eventRun.switchToAwardsMode")}
              </Button>
            </Stack>

            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Chip size="small" label="③" />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                {t("eventRun.runCeremony")}
              </Typography>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                component={RouterLink}
                to={`/events/${id}/awards`}
              >
                {t("eventRun.toCeremonyControls")}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
