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
  const { data: invites, isLoading } = useMyStaffInvites();

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <Typography variant="h5" gutterBottom>
        運営への招待
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        承諾すると、そのイベントの運営として準備や当日の操作ができるようになります。断ることもできます。
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {isLoading ? null : !invites || invites.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          返事待ちの招待はありません。
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
            <Chip size="small" label="公開前" color="default" variant="outlined" />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {invite.eventStartsAt > 0 && invite.eventEndsAt > invite.eventStartsAt
            ? formatDateRange(invite.eventStartsAt, invite.eventEndsAt)
            : "開催日時は調整中"}
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
          <Typography variant="body2">{by} さんからの招待</Typography>
        </Stack>
        {!invite.eventPublished && (
          <Alert severity="info" sx={{ mt: 2, py: 0 }}>
            このイベントはまだ公開されていません。承諾すると内容を見て、準備を一緒に進められます。
          </Alert>
        )}
        {/* 押さえていた参加枠は承諾で外れ、先着枠は直後に他の人が繰り上がるので
            実質戻せない。黙って失わせないよう、枠を持っている人には強く出す */}
        {invite.holdsSlot && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            いま押さえている参加枠は外れます。運営は参加枠を使わずに参加するためで、あとから運営を降りても枠は戻りません（先着枠は他の人が繰り上がります）。
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
          すでに参加を申し込んでいる場合、参加枠は外れて運営として参加します。
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
            承諾して運営になる
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            disabled={pending}
            onClick={() => {
              setError("");
              if (
                !window.confirm(
                  `「${invite.eventTitle}」の運営への招待を断りますか？`,
                )
              ) {
                return;
              }
              decline.mutate(invite.id, {
                onError: (e) => setError(inviteErrorMessage(e)),
              });
            }}
          >
            断る
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
