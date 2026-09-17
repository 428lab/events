import { useCallback, useRef, useState } from "react";
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
import { AwardsEditor } from "../components/AwardsEditor.js";
import { useContestAnchor } from "../lib/useContestAnchor.js";
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
  const { id = "" } = useParams();
  return <ContestControl key={id} id={id} />;
}

function ContestControl({ id }: { id: string }) {
  const { t } = useTranslation();
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
  const { data: awards, isError: awardsError } = useAwards(id);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const saveBlockedRef = useRef(false);
  const onBlockedChange = useCallback((blocked: boolean) => {
    saveBlockedRef.current = blocked;
    setSaveBlocked(blocked);
  }, []);
  const ready = Boolean(eventData && state && entries && isStaff);
  useContestAnchor("scoring", ready);
  useContestAnchor("awards", ready);
  useContestAnchor("ceremony", ready);
  const ceremonyBlocked = saveBlocked || !awards || awardsError || setMode.isPending;
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
        current={t("eventRun.operationsTitle")}
      />
      <Typography variant="h5" fontWeight={700}>
        {t("eventRun.operationsTitle")}
      </Typography>

      <Button component={RouterLink} to={`/events/${id}#contest-operations`}>{t("eventRun.backToDetailOperations")}</Button>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button component={RouterLink} to="#scoring">{t("eventRun.scoringSection")}</Button>
        <Button component={RouterLink} to="#awards">{t("eventRun.awardsSection")}</Button>
        <Button component={RouterLink} to="#ceremony" disabled={ceremonyBlocked} onClick={(e) => { if (saveBlockedRef.current) e.preventDefault(); }}>{t("eventRun.ceremonySection")}</Button>
      </Stack>
      <Typography variant="h6" component="h2">{t("eventRun.preparationSection")}</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="outlined" component={RouterLink} to={`/events/${id}/criteria`}>{t("eventRun.setupCriteria")}</Button>
        <Button variant="outlined" component={RouterLink} to="#awards">{t("eventRun.setupAwards")}</Button>
      </Stack>
      <Typography id="scoring" tabIndex={-1} sx={{ scrollMarginTop: 88 }} variant="h6" component="h2">{t("eventRun.scoringSection")}</Typography>
      <Typography>{t("eventRun.entryCount", { n: entries.length })}</Typography>
      {entries.length === 0 && <Typography>{t("eventRun.noEntriesYet")}</Typography>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="contained"
          component={RouterLink}
          to={`/events/${id}/scoring`}
        >
          {t("eventRun.scorePersonally")}
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
            {t("eventRun.modeHeading")}: {t(MODE_LABEL_KEY[state.mode])}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {EVENT_MODES.filter((m) => m !== "awards").map((m) => (
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
                    to="#awards"
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
          <Box sx={{ overflowX: "auto" }}>
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
          </Box>
        </CardContent>
      </Card>

      <Button component={RouterLink} to="#awards">{t("eventRun.chooseFromSummary")}</Button>

      <Typography id="awards" tabIndex={-1} sx={{ scrollMarginTop: 88 }} variant="h6" component="h2">{t("eventRun.awardsSection")}</Typography>
      {eventData.event.contestMode && <AwardsEditor eventId={id} onBlockedChange={onBlockedChange} />}
      <Button component={RouterLink} to="#scoring">{t("eventRun.backToSummary")}</Button>
      <Button component={RouterLink} to="#ceremony" disabled={ceremonyBlocked}
        onClick={(e) => { if (saveBlockedRef.current) e.preventDefault(); }}>{t("eventRun.prepareCeremony")}</Button>
      {saveBlocked && <Typography aria-live="polite">{t("eventRun.confirmBeforeCeremony")}</Typography>}

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography id="ceremony" tabIndex={-1} sx={{ scrollMarginTop: 88 }} variant="h6" component="h2">{t("eventRun.ceremonySection")}</Typography>
            <Typography>{t(awardTotal === 1 ? "eventRun.setWinnersCountOne" : "eventRun.setWinnersCount", {
              n: awards?.results.filter((r) => r.entryId !== null).length ?? 0, total: awardTotal,
            })}</Typography>
            <Typography>{t(state.scoringLocked ? "eventRun.scoringLockedNotice" : "eventDetail.scoringOpen")}</Typography>
            {awardTotal === 0 && <Typography>{t("eventRun.addAwardFirst")}</Typography>}
            <Typography variant="body2">{t("eventRun.unassignedAwardsHelp")}</Typography>
            <Button component={RouterLink} to="#awards">{t("eventRun.reviewWinners")}</Button>
            {setMode.isError && <Alert severity="error">{t("eventRun.awardsModeFailed")}</Alert>}
            <Button variant="outlined" disabled={ceremonyBlocked || awardTotal === 0 || state.mode === "awards"}
              onClick={() => {
                if (!saveBlockedRef.current && !ceremonyBlocked && awardTotal > 0) setMode.mutate("awards");
              }}>{t(state.mode === "awards" ? "eventRun.awardsModeActive" : "eventRun.switchParticipantsToAwards")}</Button>
            {state.mode !== "awards" && <Typography variant="body2">{t("eventRun.switchBeforeOpening")}</Typography>}
            <Button variant="contained" component={RouterLink} to={`/events/${id}/awards`}
              disabled={ceremonyBlocked || state.mode !== "awards"}
              onClick={(e) => {
                if (saveBlockedRef.current || ceremonyBlocked || state.mode !== "awards") e.preventDefault();
              }}>{t("eventRun.openCeremony")}</Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
