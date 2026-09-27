import { Alert, Button, Stack, Typography } from "@mui/material";
import type { EventLiveState } from "@eventer/shared";
import { useTranslation } from "react-i18next";
export function ManualLiveIndicatorControl({ state, fetchError, pending, saveError, onToggle }: { state?: EventLiveState; fetchError: boolean; pending: boolean; saveError: boolean; onToggle: (on: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const on = !fetchError && Boolean(state?.liveIndicatorOn);
  return <Stack spacing={0.5}>
    <Typography variant="subtitle1" fontWeight={700}>{t("studio.manualLiveHeading")} {fetchError ? t("studio.manualLiveUnknown") : on ? "ON" : "OFF"}</Typography>
    <Typography variant="caption">{t("studio.manualLiveHint")}</Typography>
    <Button variant="outlined" color={on ? "error" : "primary"} disabled={pending || fetchError || !state} onClick={() => { if (window.confirm(t("studio.manualLiveConfirm", { mode: on ? "OFF" : "ON" }))) onToggle(!on); }}>{t("studio.manualLiveToggle", { mode: on ? "OFF" : "ON" })}</Button>
    <Typography variant="caption">{t("studio.manualLiveUpdated")}: {state ? new Date(state.updatedAt).toLocaleString(i18n.language) : t("studio.manualLiveNotFetched")} / {t(saveError ? "studio.manualLiveSaveFailed" : pending ? "studio.manualLiveSaving" : "studio.manualLiveShowing")}</Typography>
    {fetchError && <Alert severity="error">{t("studio.manualLiveFetchFailed")}</Alert>}
  </Stack>;
}
