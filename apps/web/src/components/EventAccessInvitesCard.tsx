import { useState } from "react";
import { Alert, Button, Card, CardContent, Chip, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { EventAccessInvite } from "@eventer/shared";
import { api } from "../api/client.js";
import { useAccessMutation, useEventAccessInvites, previewAccessRecipient, type AccessRecipient } from "../api/eventAccessHooks.js";
import { errorCode } from "../lib/errorMessage.js";

export function EventAccessInvitesCard({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const list = useEventAccessInvites(eventId);
  const [handle, setHandle] = useState("");
  const [recipient, setRecipient] = useState<AccessRecipient | null>(null);
  const [checking, setChecking] = useState(false), [error, setError] = useState("");
  const mutation = useAccessMutation((input: { action: "send" | "reissue" | "revoke"; invite?: EventAccessInvite }) => {
    const expectedAccessRevision = list.data!.accessRevision;
    const path = `/events/${eventId}/access-invites`;
    if (input.action === "send") return api.post(path, { handle, expectedUserId: recipient!.id, expectedAccessRevision });
    if (input.action === "reissue") return api.post(`${path}/${input.invite!.id}/reissue`, { expectedAccessRevision });
    return api.del(`${path}/${input.invite!.id}`, { expectedAccessRevision, confirmCancelParticipation: true });
  });
  const onError = (e: unknown) => {
    setError(errorCode(e) === "handle_changed" ? t("eventAccess.handleChanged") : t("eventAccess.error"));
    if (errorCode(e) === "handle_changed") setRecipient(null);
    void list.refetch();
  };
  return <Card variant="outlined"><CardContent>
    <Typography variant="h6">{t("eventAccess.title")}</Typography>
    <Typography variant="body2" sx={{ mb: 1 }}>{t("eventAccess.intro")}</Typography>
    <Typography variant="body2" sx={{ mb: 2 }}>{t("eventAccess.registerFirst")}</Typography>
    {(error || list.isError) && <Alert severity="error">{error || t("eventAccess.error")}</Alert>}
    <Stack spacing={1}>
      <TextField label={t("eventAccess.handle")} value={handle} disabled={mutation.isPending || checking}
        onChange={(e) => { setHandle(e.target.value); setRecipient(null); setError(""); }} />
      <Button disabled={!handle.trim() || checking || mutation.isPending} onClick={async () => {
        setChecking(true); setRecipient(null); setError("");
        try { setRecipient(await previewAccessRecipient(handle.trim())); } catch { setError(t("eventAccess.error")); }
        finally { setChecking(false); }
      }}>{t("eventAccess.preview")}</Button>
      {recipient && <>
        <Typography>{t("eventAccess.recipient", { name: recipient.name, handle: recipient.handle })}</Typography>
        <Button variant="contained" disabled={mutation.isPending || !list.data || list.isError} onClick={() => {
          setError(""); mutation.mutate({ action: "send" }, { onError, onSuccess: () => { setHandle(""); setRecipient(null); } });
        }}>{t("eventAccess.send")}</Button>
      </>}
      {!list.isError && list.data?.invites.map((invite) => <Stack key={invite.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography sx={{ flex: 1 }}>{invite.displayName} (@{invite.handle})</Typography>
        <Chip size="small" label={t(`eventAccess.${invite.status === "accepted" ? "acceptedStatus" : invite.status}`)} />
        {invite.status !== "accepted" && <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "reissue", invite }, { onError })}>{t("eventAccess.reissue")}</Button>}
        {invite.status !== "revoked" && <Button color="warning" disabled={mutation.isPending} onClick={() => {
          if (invite.status !== "accepted" || window.confirm(t("eventAccess.revokeConfirm", { name: invite.displayName }))) mutation.mutate({ action: "revoke", invite }, { onError });
        }}>{t(invite.status === "accepted" ? "eventAccess.revokeAccess" : "eventAccess.revoke")}</Button>}
      </Stack>)}
      {!list.isError && list.data?.invites.length === 0 && <Typography>{t("eventAccess.managerEmpty")}</Typography>}
    </Stack>
  </CardContent></Card>;
}
