import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { STAFF_INVITE_STATUS_LABELS } from "@eventer/shared";
import type { StaffInvite } from "@eventer/shared";
import {
  inviteErrorMessage,
  useEventStaffInvites,
  useInviteStaff,
  useRevokeStaffInvite,
} from "../api/staffInviteHooks.js";

/** 運営スタッフの招待 (#339)。そのイベントの運営にだけ出す。
 *
 * 公開前でも一緒に準備できるようにするための入口。指名して招き、相手が承諾して
 * 初めて運営になる（勝手に運営にはしない）ので、ここでは招待の送信・状況の確認・
 * 取り消しだけを行う。 */
export function EventStaffInvitesCard({ eventId }: { eventId: string }) {
  const { data: invites } = useEventStaffInvites(eventId, true);
  const invite = useInviteStaff(eventId);
  const revoke = useRevokeStaffInvite(eventId);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState("");

  const send = () => {
    setError("");
    invite.mutate(handle.trim(), {
      onSuccess: () => setHandle(""),
      onError: (e) => setError(inviteErrorMessage(e)),
    });
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          運営に招く
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          ユーザー名で指名して招待します。相手が承諾すると運営になり、公開前でも一緒に準備できます。承諾するまでは運営ではありません。
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField
            size="small"
            label="ユーザー名で招待"
            placeholder="例: kojira"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && handle.trim() && !invite.isPending) send();
            }}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            disabled={!handle.trim() || invite.isPending}
            onClick={send}
          >
            招待
          </Button>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        {!invites || invites.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            招待はまだありません。
          </Typography>
        ) : (
          <Stack spacing={1}>
            {invites.map((i) => (
              <InviteRow
                key={i.id}
                invite={i}
                onRevoke={() => revoke.mutate(i.id, {
                  onError: (e) => setError(inviteErrorMessage(e)),
                })}
                revoking={revoke.isPending}
              />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_COLOR = {
  pending: "warning",
  accepted: "success",
  declined: "default",
  revoked: "default",
} as const;

function InviteRow({
  invite,
  onRevoke,
  revoking,
}: {
  invite: StaffInvite;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const name = invite.user.globalName ?? invite.user.username;
  const by = invite.invitedBy.globalName ?? invite.invitedBy.username;
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Avatar src={invite.user.avatarUrl ?? undefined} sx={{ width: 28, height: 28 }}>
        {name.charAt(0)}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {name}{" "}
          <Typography component="span" variant="caption" color="text.secondary">
            @{invite.user.username}
          </Typography>
        </Typography>
        {/* 誰が誰を招いたかが後から分かるようにする (#339) */}
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          招待: {by}
        </Typography>
      </Box>
      <Chip
        size="small"
        color={STATUS_COLOR[invite.status]}
        variant={invite.status === "pending" ? "filled" : "outlined"}
        label={STAFF_INVITE_STATUS_LABELS[invite.status]}
      />
      {invite.status === "pending" && (
        <Chip
          size="small"
          label="取り消し"
          clickable
          disabled={revoking}
          onClick={onRevoke}
        />
      )}
    </Stack>
  );
}
