import { Alert, Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { MyEventAccess, MyEventInvite } from "@eventer/shared";
import { api } from "../api/client.js";
import { useAccessMutation, useMyEventAccess, useMyEventInvites } from "../api/eventAccessHooks.js";
import { useEvent } from "../api/hooks.js";

export function EventInvitesPage() {
  const { t } = useTranslation();
  const pending = useMyEventInvites(), accepted = useMyEventAccess();
  return <Box sx={{ maxWidth: 720, mx: "auto" }}>
    <Typography variant="h5">{t("eventAccess.title")}</Typography>
    <Alert severity="info" sx={{ my: 2 }}>{t("eventAccess.intro")}</Alert>
    {pending.isError ? <Alert severity="error">{t("eventAccess.error")}</Alert> : <Stack spacing={2}>
      {pending.data?.pages.flatMap((p) => p.invites).map((invite) => <PendingInvite key={invite.id} invite={invite} />)}
      {!pending.isLoading && !pending.data?.pages[0]?.invites.length && <Typography>{t("eventAccess.empty")}</Typography>}
      {pending.hasNextPage && <Button onClick={() => pending.fetchNextPage()} disabled={pending.isFetching}>{t("eventAccess.more")}</Button>}
    </Stack>}
    <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>{t("eventAccess.accepted")}</Typography>
    {accepted.isError ? <Alert severity="error">{t("eventAccess.error")}</Alert> : <Stack spacing={2}>
      {accepted.data?.pages.flatMap((p) => p.accesses).map((access) => <AccessCard key={access.id} access={access} />)}
      {!accepted.isLoading && !accepted.data?.pages[0]?.accesses.length && <Typography>{t("eventAccess.noAccess")}</Typography>}
      {accepted.hasNextPage && <Button onClick={() => accepted.fetchNextPage()} disabled={accepted.isFetching}>{t("eventAccess.more")}</Button>}
    </Stack>}
  </Box>;
}
function PendingInvite({ invite }: { invite: MyEventInvite }) {
  const { t } = useTranslation(), navigate = useNavigate();
  const respond = useAccessMutation((action: "accept" | "decline") =>
    api.post<{ eventId?: string; canOpenEvent?: boolean }>(`/me/event-invites/${invite.id}/${action}`, {}));
  return <Card variant="outlined"><CardContent>
    <Typography variant="h6">{invite.title}</Typography>
    <Typography>{t("eventAccess.from", { name: invite.inviterName ?? t("eventAccess.unknown"), date: new Date(invite.expiresAt).toLocaleString() })}</Typography>
    {respond.isError && <Alert severity="error">{t("eventAccess.error")}</Alert>}
    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
      <Button variant="contained" disabled={respond.isPending} onClick={() => respond.mutate("accept", {
        onSuccess: (data) => { if (data.canOpenEvent && data.eventId) navigate(`/events/${data.eventId}`); },
      })}>{t("eventAccess.accept")}</Button>
      <Button disabled={respond.isPending} onClick={() => { if (window.confirm(t("eventAccess.declineConfirm"))) respond.mutate("decline"); }}>{t("eventAccess.decline")}</Button>
    </Stack>
  </CardContent></Card>;
}
function AccessCard({ access }: { access: MyEventAccess }) {
  const { t } = useTranslation();
  const leave = useAccessMutation(() => api.del(`/events/${access.eventId}/access`, { confirmCancelParticipation: true }));
  return <Card variant="outlined"><CardContent>
    {access.canOpenEvent ? <OpenEvent eventId={access.eventId} /> : <Typography>{t("eventAccess.unavailable")}</Typography>}
    <Typography variant="body2">{t("eventAccess.identity", { id: access.id.slice(0, 8), date: new Date(access.createdAt).toLocaleString() })}</Typography>
    {leave.isError && <Alert severity="error">{t("eventAccess.error")}</Alert>}
    {access.canLeave ? <Button color="warning" disabled={leave.isPending} onClick={() => {
      if (window.confirm(t("eventAccess.leaveConfirm"))) leave.mutate(undefined);
    }}>{t("eventAccess.leave")}</Button> : <Typography>{t("eventAccess.managed")}</Typography>}
  </CardContent></Card>;
}
function OpenEvent({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const event = useEvent(eventId);
  if (event.isError || !event.data) return <Typography>{t("eventAccess.unavailable")}</Typography>;
  return <Button component={RouterLink} to={`/events/${eventId}`}>{event.data.event.title} — {t("eventAccess.open")}</Button>;
}
