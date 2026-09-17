import { Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Event, EventRole } from "@eventer/shared";
import { useEventEntries, useMe } from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { SelfEntryParticipation } from "./SelfEntryParticipation.js";
import { useContestAnchor } from "../lib/useContestAnchor.js";

export function ContestOperationsSection({ eventId, event, myRole }: {
  eventId: string; event: Event; myRole: EventRole | null;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: entries } = useEventEntries(eventId);
  const { data: state } = useEventState(eventId, Boolean(me));
  useContestAnchor("contest-operations");
  if (myRole !== "staff" || !event.contestMode) return null;
  const myEntry = entries?.find((entry) => me && entry.memberUserIds.includes(me.id));
  const link = (path: string, label: string) => (
    <Button variant="outlined" component={RouterLink} to={`/events/${eventId}${path}`}>{label}</Button>
  );
  const buttons = { direction: { xs: "column", sm: "row" }, spacing: 1 } as const;
  return (
    <Card variant="outlined" id="contest-operations" tabIndex={-1} sx={{ scrollMarginTop: 88 }}>
      <CardContent>
        <Stack spacing={3}>
          <Typography variant="h6" component="h2">{t("eventRun.operationsTitle")}</Typography>
          {state && state.mode !== "normal" && <Chip sx={{ alignSelf: "flex-start" }} label={t("eventDetail.modeRunning", {
            mode: t(state.mode === "presentation" ? "eventDetail.modePresentation" : state.mode === "aggregation" ? "eventDetail.modeAggregation" : "eventDetail.modeAwards"),
          })} />}
          <Stack spacing={1}>
            <Typography fontWeight={700}>{t("eventRun.preparationSection")}</Typography>
            <Stack {...buttons}>
              {link("/criteria", t("eventRun.setupCriteria"))}
              {link("/control#awards", t("eventRun.setupAwards"))}
            </Stack>
          </Stack>
          <Stack spacing={1}>
            <Typography fontWeight={700}>{t("eventRun.scoringSection")}</Typography>
            <Stack {...buttons}>
              {link("/control#scoring", t("eventRun.entryProgress"))}
              {link("/scoring", t("eventRun.scorePersonally"))}
              {state?.mode === "presentation" && link("/present", t("eventDetail.toPresentation"))}
            </Stack>
            <SelfEntryParticipation eventId={eventId} event={event} myRole={myRole} />
            {myEntry && link("#submissions", t("eventRun.mySubmissionLink"))}
          </Stack>
          <Stack spacing={1}>
            <Typography fontWeight={700}>{t("eventRun.awardsSection")}</Typography>
            {link("/control#awards", t("eventRun.chooseFromSummary"))}
          </Stack>
          <Stack spacing={1}>
            <Typography fontWeight={700}>{t("eventRun.ceremonySection")}</Typography>
            {link("/control#ceremony", t("eventRun.prepareCeremony"))}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
