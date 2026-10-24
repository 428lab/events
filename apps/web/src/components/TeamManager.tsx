import { useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, FormControlLabel, MenuItem,
  Stack, Switch, TextField, Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Entry, Event, EventMemberWithUser } from "@eventer/shared";
import { TEAM_CAPACITY_MAX, TEAM_DESCRIPTION_MAX, TEAM_NAME_MAX } from "@eventer/shared";
import { useEventEntries, useEventMembers } from "../api/hooks.js";
import { teamApi, useTeamAction } from "../api/teamHooks.js";
import { errorCode } from "../lib/errorMessage.js";
import { tDynamic } from "../i18n/index.js";

/** 運営のチーム管理 (#9, docs/team-participation.md)。チーム参加のオン・オフ、
 * チームの作成・変更・削除、リーダーを立てる、メンバーの移動・未所属の割り当て */
export function TeamManager({ eventId, event }: { eventId: string; event: Event }) {
  const { t } = useTranslation();
  const { data: entries } = useEventEntries(eventId);
  const { data: members } = useEventMembers(eventId, true);
  const api = teamApi(eventId);
  const mode = useTeamAction(eventId, api.setMode, true);
  const create = useTeamAction(eventId, api.create);
  const update = useTeamAction(eventId, api.update);
  const remove = useTeamAction(eventId, api.remove);
  const leader = useTeamAction(eventId, api.setLeader);
  const assign = useTeamAction(eventId, api.assign);
  const actions = [mode, create, update, remove, leader, assign];
  const pending = actions.some((a) => a.isPending);
  const failed = actions.find((a) => a.isError);
  const teamMode = event.participationType === "team";

  const teams = teamMode ? (entries ?? []).filter((e) => e.kind === "team") : [];
  const participants = (members ?? []).filter((m) => m.role === "participant" && m.status === "confirmed");
  const assigned = new Set(teams.flatMap((team) => team.memberUserIds));
  const unassigned = participants.filter((m) => !assigned.has(m.userId));
  const nameOf = new Map(participants.map((m) => [m.userId, m.user.globalName ?? m.user.username]));

  return (
    <Card variant="outlined" id="teams" tabIndex={-1} sx={{ scrollMarginTop: 88 }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">{t("teams.manageTitle")}</Typography>
          <Box>
            <FormControlLabel
              label={t("teams.modeLabel")}
              control={<Switch checked={teamMode} disabled={pending} onChange={(_, on) => mode.mutate(on)} />}
            />
            <Typography variant="body2" color="text.secondary">{t("teams.modeHelp")}</Typography>
          </Box>
          {failed && <Alert severity="error">{tDynamic(`teams.error_${errorCode(failed.error) ?? "default"}`, t("teams.error_default"))}</Alert>}
          {teamMode && <>
            <CreateTeamForm disabled={pending} onCreate={(input) => create.mutate(input)} />
            <Divider />
            {teams.length === 0 && <Typography color="text.secondary">{t("teams.noTeams")}</Typography>}
            {teams.map((team) => (
              <TeamCard key={team.id} team={team} teams={teams} participants={participants} nameOf={nameOf} disabled={pending}
                onUpdate={(input) => update.mutate({ teamId: team.id, input })}
                onRemove={() => window.confirm(t("teams.deleteConfirm", { name: team.name })) && remove.mutate(team.id)}
                onLeader={(userId) => leader.mutate({ teamId: team.id, userId })}
                onMove={(userId, teamId) => assign.mutate({ userId, teamId })} />
            ))}
            <Box>
              <Typography fontWeight={700}>{t("teams.unassigned", { count: unassigned.length })}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("teams.unassignedHelp")}</Typography>
              <Stack spacing={1}>
                {unassigned.map((m) => (
                  <MoveRow key={m.userId} name={nameOf.get(m.userId) ?? ""} teams={teams} currentTeamId={null} disabled={pending}
                    onMove={(teamId) => assign.mutate({ userId: m.userId, teamId })} />
                ))}
              </Stack>
            </Box>
          </>}
        </Stack>
      </CardContent>
    </Card>
  );
}

function CreateTeamForm({ disabled, onCreate }: {
  disabled: boolean; onCreate: (input: { name: string; description: string; capacity: number | null }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const cap = capacity.trim() === "" ? null : Number(capacity);
  // 名前は空欄でよい（サーバーが「チーム1」…を付ける。名前はあとでリーダーが変えられる）
  const valid = cap === null || (Number.isInteger(cap) && cap >= 1 && cap <= TEAM_CAPACITY_MAX);
  return (
    <Stack spacing={1}>
      <Typography fontWeight={700}>{t("teams.createHeading")}</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField size="small" label={t("teams.nameOptional")} value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: TEAM_NAME_MAX }} sx={{ flex: 2 }} />
        <TextField size="small" label={t("teams.capacity")} value={capacity} onChange={(e) => setCapacity(e.target.value)} inputProps={{ inputMode: "numeric" }} sx={{ flex: 1 }} />
      </Stack>
      <TextField size="small" label={t("teams.description")} value={description} onChange={(e) => setDescription(e.target.value)} inputProps={{ maxLength: TEAM_DESCRIPTION_MAX }} />
      <Box>
        <Button variant="contained" disabled={disabled || !valid} onClick={() => {
          onCreate({ name: name.trim(), description: description.trim(), capacity: cap });
          setName(""); setDescription(""); setCapacity("");
        }}>{t("teams.create")}</Button>
      </Box>
    </Stack>
  );
}

function TeamCard({ team, teams, participants, nameOf, disabled, onUpdate, onRemove, onLeader, onMove }: {
  team: Entry; teams: Entry[]; participants: EventMemberWithUser[]; nameOf: Map<string, string>; disabled: boolean;
  onUpdate: (input: { name?: string; description?: string; capacity?: number | null }) => void;
  onRemove: () => void; onLeader: (userId: string | null) => void; onMove: (userId: string, teamId: string | null) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [capacity, setCapacity] = useState(team.capacity?.toString() ?? "");
  const count = team.memberUserIds.length;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
      <Stack spacing={1}>
        {editing ? (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField size="small" label={t("teams.name")} value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: TEAM_NAME_MAX }} sx={{ flex: 2 }} />
            <TextField size="small" label={t("teams.capacity")} value={capacity} onChange={(e) => setCapacity(e.target.value)} inputProps={{ inputMode: "numeric" }} sx={{ flex: 1 }} />
            <Button disabled={disabled || !name.trim()} onClick={() => {
              onUpdate({ name: name.trim(), capacity: capacity.trim() === "" ? null : Number(capacity) });
              setEditing(false);
            }}>{t("teams.save")}</Button>
            <Button color="inherit" onClick={() => setEditing(false)}>{t("teams.cancel")}</Button>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography fontWeight={700}>{team.name}</Typography>
            <Chip size="small" label={team.capacity == null ? t("teams.members", { count }) : t("teams.membersWithCapacity", { count, capacity: team.capacity })} />
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" disabled={disabled} onClick={() => setEditing(true)}>{t("teams.edit")}</Button>
            <Button size="small" color="error" disabled={disabled || count > 0 || Boolean(team.submission)} onClick={onRemove}>{t("teams.delete")}</Button>
          </Stack>
        )}
        {team.description && <Typography variant="body2" color="text.secondary">{team.description}</Typography>}
        <TextField select size="small" label={t("teams.leader")} value={team.leaderUserId ?? ""} disabled={disabled}
          helperText={t("teams.leaderHelp")}
          onChange={(e) => onLeader(e.target.value || null)} sx={{ maxWidth: 360 }}>
          <MenuItem value="">{t("teams.noLeader")}</MenuItem>
          {participants.map((m) => <MenuItem key={m.userId} value={m.userId}>{nameOf.get(m.userId)}</MenuItem>)}
        </TextField>
        <Stack spacing={1}>
          {team.memberUserIds.map((userId) => (
            <MoveRow key={userId} name={nameOf.get(userId) ?? ""} leader={userId === team.leaderUserId} teams={teams}
              currentTeamId={team.id} disabled={disabled} onMove={(teamId) => onMove(userId, teamId)} />
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

function MoveRow({ name, leader, teams, currentTeamId, disabled, onMove }: {
  name: string; leader?: boolean; teams: Entry[]; currentTeamId: string | null; disabled: boolean; onMove: (teamId: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {/* 名前とバッジは折り返して縦に積む（狭い画面で名前が1文字ずつ折れないように） */}
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ overflowWrap: "anywhere" }}>{name}</Typography>
        {leader && <Chip size="small" color="primary" label={t("teams.leaderBadge")} />}
      </Stack>
      <TextField select size="small" label={currentTeamId ? t("teams.moveTo") : t("teams.assign")} value={currentTeamId ?? ""}
        disabled={disabled} onChange={(e) => onMove(e.target.value || null)} sx={{ width: { xs: 150, sm: 220 }, flexShrink: 0 }}>
        <MenuItem value="">{currentTeamId ? t("teams.unassign") : "—"}</MenuItem>
        {teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
      </TextField>
    </Stack>
  );
}
