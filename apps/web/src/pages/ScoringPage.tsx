import {
  Alert,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent, useEventEntries, useIsAdmin, useMe } from "../api/hooks.js";
import {
  useCriteria,
  useEventState,
  useMyScores,
} from "../api/scoringHooks.js";
import { ScoringPanel } from "../components/ScoringPanel.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";

export function ScoringPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const isAdmin = useIsAdmin();
  const { data: eventData } = useEvent(id);
  const { data: state } = useEventState(id);
  const { data: entries } = useEventEntries(id);
  const { data: criteria } = useCriteria(id);
  const { data: myScores } = useMyScores(id);

  if (!eventData || !state || !entries || !criteria) {
    return <Typography>{t("common.loading")}</Typography>;
  }

  const role = eventData.myRole;
  if (!role && !isAdmin) {
    return <Alert severity="info">{t("eventRun.scoringMembersOnly")}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current={t("eventDetail.scoring")}
      />
      <Typography variant="h5" fontWeight={700}>
        {t("eventDetail.scoring")}
      </Typography>
      {state.scoringLocked && (
        <Alert severity="warning">{t("eventRun.scoringLockedNotice")}</Alert>
      )}
      {entries.map((entry) => {
        const isSelf = Boolean(me && entry.memberUserIds.includes(me.id));
        const disabled =
          state.scoringLocked ||
          (!eventData.event.aggregateSelfEntry && isSelf);
        return (
          <Card key={entry.id} variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {entry.name}
                {isSelf && (
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 1 }}
                  >
                    {t("eventRun.selfEntrySuffix")}
                  </Typography>
                )}
              </Typography>
              <ScoringPanel
                eventId={id}
                entryId={entry.id}
                criteria={criteria}
                myScores={myScores ?? []}
                disabled={disabled}
              />
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
