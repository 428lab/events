import { Alert, Button, CircularProgress, Stack } from "@mui/material";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEvent, useEventSlots } from "../api/hooks.js";
import { useEventNameCards } from "../api/nameCardHooks.js";
import { useCardAssets, useCardDesign } from "../api/cardDesignHooks.js";
import { CardEditor } from "../components/cardEditor/CardEditor.js";

export function EventCardEditorPage() {
  const { id = "" } = useParams(), { t } = useTranslation();
  const event = useEvent(id), slots = useEventSlots(id);
  const isStaff = event.data?.myRole === "staff";
  const design = useCardDesign(id, isStaff), assets = useCardAssets(id, isStaff);
  const members = useEventNameCards(id, isStaff);
  if (!event.data) return event.isError ? <Alert severity="error">{t("staffOps.cardEditorLoadFailed")}</Alert> : <CircularProgress />;
  if (!isStaff) return <Alert severity="info">{t("staffOps.nameCardStaffOnly")}</Alert>;
  if (!design.data || !assets.data || !members.data || !slots.data) {
    if (design.isError || assets.isError || members.isError || slots.isError) return <Stack spacing={2}>
      <Alert severity="error">{t("staffOps.cardEditorLoadFailed")}</Alert>
      <Button onClick={() => { void design.refetch(); void assets.refetch(); void members.refetch(); void slots.refetch(); }}>{t("staffOps.cardEditorRetry")}</Button>
    </Stack>;
    return <CircularProgress />;
  }
  return <CardEditor key={id} initial={design.data} assets={assets.data.assets} members={members.data.cards} slots={slots.data}
    context={{ eventId: id, title: event.data.event.title, origin: window.location.origin,
      eventUrl: `${window.location.origin}/events/${encodeURIComponent(event.data.event.slug || id)}`,
      communityName: event.data.community?.name ?? "", communityLogo: event.data.community?.iconUrl ?? null }} />;
}
