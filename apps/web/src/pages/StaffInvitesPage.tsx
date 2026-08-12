import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { MyStaffInvite } from "@eventer/shared";
import {
  inviteErrorMessage,
  useMyStaffInvites,
  useRespondStaffInvite,
} from "../api/staffInviteHooks.js";
import { formatDateRange } from "../lib/format.js";

/**
 * 自分宛の「運営に招かれています」一覧 (#339)。
 *
 * 承諾するまでイベントページは開けない（公開前は非メンバーに見せないため）ので、
 * 判断に要る題名・開催日時・招待した人だけをここに出す。
 */
export function StaffInvitesPage() {
  const { t } = useTranslation();
  const { data: invites, isLoading } = useMyStaffInvites();

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <Typography variant="h5" gutterBottom>
        {t("staffOps.myInvitesTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("staffOps.myInvitesIntro")}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {isLoading ? null : !invites || invites.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("staffOps.myInvitesEmpty")}
        </Typography>
      ) : (
        <Stack spacing={2}>
          {invites.map((invite) => (
            <InviteCard key={invite.id} invite={invite} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function InviteCard({ invite }: { invite: MyStaffInvite }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accept = useRespondStaffInvite("accept");
  const decline = useRespondStaffInvite("decline");
  const [error, setError] = useState("");
  const by = invite.invitedBy.globalName ?? invite.invitedBy.username;
  const pending = accept.isPending || decline.isPending;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }}>
            {invite.eventTitle}
          </Typography>
          {!invite.eventPublished && (
            <Chip
              size="small"
              label={t("staffOps.invitePreRelease")}
              color="default"
              variant="outlined"
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {invite.eventStartsAt > 0 && invite.eventEndsAt > invite.eventStartsAt
            ? formatDateRange(invite.eventStartsAt, invite.eventEndsAt)
            : t("staffOps.inviteScheduleTbd")}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
          <Avatar
            component={RouterLink}
            to={`/users/${invite.invitedBy.username}`}
            src={invite.invitedBy.avatarUrl ?? undefined}
            sx={{ width: 28, height: 28, textDecoration: "none" }}
          >
            {by.charAt(0)}
          </Avatar>
          <Typography variant="body2">
            {t("staffOps.inviteFrom", { name: by })}
          </Typography>
        </Stack>
        {!invite.eventPublished && (
          <Alert severity="info" sx={{ mt: 2, py: 0 }}>
            {t("staffOps.inviteDraftNotice")}
          </Alert>
        )}
        {/* 申し込んでいた参加枠は承諾で外れ、先着枠は直後に他の人が繰り上がるので
            実質戻せない。黙って失わせないよう、枠を持っている人には強く出す。
            確定だけでなく抽選の申込中・キャンセル待ちも外れるので、
            「確定した席」と読めない書き方にする */}
        {invite.holdsSlot && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t("staffOps.inviteSlotWarning")}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
          {t("staffOps.inviteSlotNote")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button
            variant="contained"
            disabled={pending}
            onClick={() => {
              setError("");
              accept.mutate(invite.id, {
                onSuccess: () => navigate(`/events/${invite.eventId}`),
                onError: (e) => setError(inviteErrorMessage(e)),
              });
            }}
          >
            {t("staffOps.inviteAccept")}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={pending}
            onClick={() => {
              setError("");
              if (
                !window.confirm(
                  t("staffOps.inviteDeclineConfirm", {
                    title: invite.eventTitle,
                  }),
                )
              ) {
                return;
              }
              decline.mutate(invite.id, {
                onError: (e) => setError(inviteErrorMessage(e)),
              });
            }}
          >
            {t("staffOps.inviteDecline")}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
