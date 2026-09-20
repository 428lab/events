import { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Event } from "@eventer/shared";
import { useReopenScheduling } from "../api/scheduleHooks.js";
import { ApiError } from "../api/client.js";
import { formatDateRange, formatDateTime } from "../lib/format.js";

/** Keep the revision and deadline actually shown in the confirmation together. */
export function ReopenSchedulingButton({ event }: { event: Event }) {
  const { t } = useTranslation();
  const reopen = useReopenScheduling(event.id);
  const [confirmation, setConfirmation] = useState<Event | null>(null);
  const conflict = reopen.error instanceof ApiError && reopen.error.status === 409;
  return <>
    <Typography sx={{ px: 2, pt: 2 }}>{formatDateRange(event.startsAt, event.endsAt)}</Typography>
    <Button sx={{ m: 1 }} onClick={() => { reopen.reset(); setConfirmation(event); }}>{t("schedule.reopen")}</Button>
    <Dialog open={Boolean(confirmation)} onClose={() => { if (!reopen.isPending) setConfirmation(null); }} fullWidth maxWidth="sm">
      <DialogTitle>{t("schedule.reopen")}</DialogTitle>
      <DialogContent>
        <Typography>{t("schedule.reopenConfirm")}</Typography>
        {confirmation?.registrationDeadline != null && <Typography sx={{ mt: 1 }}>
          {t("schedule.reopenDeadline", { date: formatDateTime(confirmation.registrationDeadline) })}
        </Typography>}
        {confirmation && confirmation.endsAt < Date.now() && <Typography sx={{ mt: 1 }}>{t("schedule.reopenEnded")}</Typography>}
        {reopen.isError && <Alert severity="error" sx={{ mt: 1 }}>{t(conflict ? "schedule.changed" : "schedule.reopenFailed")}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={reopen.isPending} onClick={() => setConfirmation(null)}>{t("common.cancel")}</Button>
        <Button disabled={reopen.isPending || conflict} onClick={() => {
          if (!confirmation) return;
          reopen.mutate({ expectedAccessRevision: confirmation.accessRevision,
            ...(confirmation.registrationDeadline !== null ? { clearRegistrationDeadline: true as const } : {}) },
          { onSuccess: () => setConfirmation(null) });
        }}>{t("schedule.reopen")}</Button>
      </DialogActions>
    </Dialog>
  </>;
}
