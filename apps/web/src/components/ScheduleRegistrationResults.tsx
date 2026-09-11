import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ScheduleRegistrationResult } from "@eventer/shared";
import { api } from "../api/client.js";

export function ScheduleRegistrationResults({
  eventId,
  open,
  onClose,
}: {
  eventId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["scheduleRegistration", eventId],
    enabled: open,
    queryFn: () =>
      api.get<{ results: ScheduleRegistrationResult[] }>(
        `/events/${eventId}/schedule-registration`,
      ),
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("schedule.autoJoinResults")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t("schedule.autoJoinSnapshot")}
        </Typography>
        {query.isLoading && (
          <Typography>{t("schedule.autoJoinLoading")}</Typography>
        )}
        {query.isError && (
          <Alert severity="error">{t("schedule.autoJoinFailed")}</Alert>
        )}
        {query.data && (
          <Stack spacing={2}>
            {(["registered", "existing", "action_required"] as const).map(
              (outcome) => {
                const rows = query.data.results.filter(
                  (r) => r.outcome === outcome,
                );
                return (
                  <section key={outcome}>
                    <Typography variant="subtitle1">
                      {t(`schedule.autoJoin_${outcome}`)} ({rows.length})
                    </Typography>
                    {rows.map((r) => (
                      <Typography
                        key={r.userId}
                        variant="body2"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {r.name} —{" "}
                        {r.reason
                          ? t(`schedule.autoJoinReason_${r.reason}`)
                          : r.status
                            ? t(`schedule.autoJoinStatus_${r.status}`)
                            : "—"}
                      </Typography>
                    ))}
                  </section>
                );
              },
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("schedule.autoJoinClose")}</Button>
      </DialogActions>
    </Dialog>
  );
}
