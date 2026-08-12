import { useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  createFilterOptions,
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
import { useTranslation } from "react-i18next";
import { STAFF_INVITE_STATUS_LABELS } from "@eventer/shared";
import type { StaffInvite } from "@eventer/shared";
import { useEventMembers } from "../api/hooks.js";
import { useMyFollowing } from "../api/userHooks.js";
import {
  inviteErrorMessage,
  useEventStaffInvites,
  useInviteStaff,
  useRevokeStaffInvite,
} from "../api/staffInviteHooks.js";
import { tDynamic } from "../i18n/index.js";

/** 運営スタッフの招待 (#339)。そのイベントの運営にだけ出す。
 *
 * 公開前でも一緒に準備できるようにするための入口。指名して招き、相手が承諾して
 * 初めて運営になる（勝手に運営にはしない）ので、ここでは招待の送信・状況の確認・
 * 取り消しだけを行う。 */

/** 入力の候補。ユーザー名を正確に覚えていなくても選べるようにするためのもので、
 * ここに出ない人でも手入力で招ける（freeSolo）。
 * 出どころは「このイベントの参加者」と「自分がフォローしている人」の2つ */
interface Candidate {
  username: string;
  label: string;
  avatarUrl: string | null;
  /** 出どころ。見出しの文言ではなく**英字のキー**で持ち、表示のたびに訳す */
  source: CandidateSource;
}

type CandidateSource = "members" | "following";

const CANDIDATE_SOURCE_KEY = {
  members: "staffOps.inviteCandidateMembers",
  following: "staffOps.inviteCandidateFollowing",
} as const;

/** 表示名でもユーザー名でも絞り込めるようにする */
const CANDIDATE_FILTER = createFilterOptions<Candidate>({
  stringify: (o) => `${o.label} ${o.username}`,
});

export function EventStaffInvitesCard({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { data: invites } = useEventStaffInvites(eventId, true);
  const { data: members } = useEventMembers(eventId, true);
  const { data: following } = useMyFollowing();
  const invite = useInviteStaff(eventId);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState("");

  /** すでに運営の人・招待済みの人は候補から外す（選んでもエラーになるだけ） */
  const candidates = useMemo<Candidate[]>(() => {
    const excluded = new Set<string>();
    for (const m of members ?? []) {
      if (m.role === "staff") excluded.add(m.user.username);
    }
    for (const i of invites ?? []) {
      if (i.status === "pending" || i.status === "accepted") {
        excluded.add(i.user.username);
      }
    }
    const byHandle = new Map<string, Candidate>();
    for (const m of members ?? []) {
      byHandle.set(m.user.username, {
        username: m.user.username,
        label: m.user.globalName ?? m.user.username,
        avatarUrl: m.user.avatarUrl,
        source: "members",
      });
    }
    for (const f of following ?? []) {
      if (byHandle.has(f.username)) continue;
      byHandle.set(f.username, {
        username: f.username,
        label: f.globalName ?? f.username,
        avatarUrl: f.avatarUrl,
        source: "following",
      });
    }
    return [...byHandle.values()].filter((c) => !excluded.has(c.username));
  }, [members, following, invites]);

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
          {t("staffOps.inviteStaffTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("staffOps.inviteStaffIntro")}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Autocomplete
            freeSolo
            openOnFocus
            size="small"
            sx={{ flex: 1 }}
            options={candidates}
            // 既定の絞り込みは getOptionLabel（＝ユーザー名）しか見ないので、
            // 表示名で打つと候補が全部消える。ラベルが「名前かユーザー名」である
            // 以上、絞り込みも両方を見ること
            filterOptions={CANDIDATE_FILTER}
            groupBy={(o) => t(CANDIDATE_SOURCE_KEY[o.source])}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.username)}
            inputValue={handle}
            onInputChange={(_, v) => setHandle(v)}
            renderOption={(props, o) => (
              <Box component="li" {...props} key={o.username}>
                <Avatar
                  src={o.avatarUrl ?? undefined}
                  sx={{ width: 24, height: 24, mr: 1 }}
                >
                  {o.label.charAt(0)}
                </Avatar>
                {o.label}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 0.5 }}
                >
                  @{o.username}
                </Typography>
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t("staffOps.inviteStaffField")}
                placeholder={t("staffOps.inviteStaffPlaceholder")}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
          />
          <Button
            variant="outlined"
            disabled={!handle.trim() || invite.isPending}
            onClick={send}
            sx={{ flexShrink: 0 }}
          >
            {t("staffOps.inviteStaffSend")}
          </Button>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        {!invites || invites.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("staffOps.inviteStaffEmpty")}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {invites.map((i) => (
              <InviteRow key={i.id} eventId={eventId} invite={i} />
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
  eventId,
  invite,
}: {
  eventId: string;
  invite: StaffInvite;
}) {
  const { t } = useTranslation();
  // 行ごとに持つ。1つを全行で共有すると、1件を取り消している間じゅう
  // 他の行のボタンまで無効になり、続けて操作できない
  const revoke = useRevokeStaffInvite(eventId);
  const [error, setError] = useState("");
  const name = invite.user.globalName ?? invite.user.username;
  const by = invite.invitedBy.globalName ?? invite.invitedBy.username;
  // 断られた行も片付けられるようにする（残り続けると一覧が読めなくなる）。
  // 承諾済みだけは消せない：消しても運営から外れないので取り違えのもと
  const removable = invite.status === "pending" || invite.status === "declined";

  return (
    <Box>
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
            {t("staffOps.inviteStaffBy", { name: by })}
          </Typography>
        </Box>
        <Chip
          size="small"
          color={STATUS_COLOR[invite.status]}
          variant={invite.status === "pending" ? "filled" : "outlined"}
          label={tDynamic(
            `staffInviteStatus.${invite.status}`,
            STAFF_INVITE_STATUS_LABELS[invite.status],
          )}
        />
        {removable && (
          <Chip
            size="small"
            label={t(
              invite.status === "pending"
                ? "staffOps.inviteStaffRevoke"
                : "staffOps.inviteStaffRemoveRow",
            )}
            clickable
            disabled={revoke.isPending}
            onClick={() => {
              setError("");
              revoke.mutate(invite.id, {
                onError: (e) => setError(inviteErrorMessage(e)),
              });
            }}
          />
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 0.5 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
