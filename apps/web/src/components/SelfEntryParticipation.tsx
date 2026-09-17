import { Alert, Box, FormControlLabel, LinearProgress, Switch, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Event, EventRole } from "@eventer/shared";
import { useEventEntries, useMe, useSelfEntryParticipation } from "../api/hooks.js";
import { ApiError } from "../api/client.js";

export function SelfEntryParticipation({ eventId, event, myRole }: {
  eventId: string; event: Event; myRole: EventRole | null;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: entries } = useEventEntries(eventId);
  const participation = useSelfEntryParticipation(eventId);
  const myIndividualEntry = entries?.find((e) => e.kind === "individual" && me && e.memberUserIds.includes(me.id));
  const alreadyScored = participation.error instanceof ApiError &&
    (participation.error.body as { error?: string } | null)?.error === "entry_already_scored";
  return <>
      {myRole === "staff" && event.participationType === "individual" && (
        <Box>
          <FormControlLabel
            label={t("eventDetail.selfScoringParticipation")}
            control={<Switch
              checked={Boolean(myIndividualEntry)}
              disabled={!entries || participation.isPending}
              onChange={(_, checked) => {
                if (checked || window.confirm(t("eventDetail.selfScoringOffConfirm"))) {
                  participation.mutate(checked);
                }
              }}
            />}
          />
          {participation.isPending && <LinearProgress />}
          {participation.isError && <Alert severity="error">
            {t(alreadyScored ? "eventDetail.selfScoringAlreadyScored" : "eventDetail.selfScoringChangeFailed")}
          </Alert>}
        </Box>
      )}
    {myRole === "staff" && event.participationType === "individual" && (
      <Typography variant="body2" color="text.secondary">{t("eventRun.selfEntryHelp")}</Typography>
    )}
  </>;
}
