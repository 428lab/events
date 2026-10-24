import { useState } from "react";
import { Alert, Box, Button, Card, CardContent, Chip, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Entry, Event, EventRole, UpdateMyTeamInput } from "@eventer/shared";
import { TEAM_DESCRIPTION_MAX, TEAM_NAME_MAX } from "@eventer/shared";
import { useEventEntries, useEventMembers, useMe } from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { teamApi, useTeamAction } from "../api/teamHooks.js";
import { findMyMembership } from "../lib/eventMembership.js";
import { errorCode } from "../lib/errorMessage.js";
import { tDynamic } from "../i18n/index.js";

/**
 * 参加者がチームを選ぶ (#9, docs/team-participation.md)。チーム参加のコンテストだけに出る。
 * 採点が始まる（締切または点が入る）までは、入る・移る・抜けるができる。
 * 締切はサーバーが判定する（ここは表示のため）。点が入ったかは画面からは分からないので、
 * そのときはサーバーの team_locked を案内する。
 *
 * 自分のチームでは、リーダーが名前・ひとことを変えたり、メンバーにリーダーを任せたりできる。
 * リーダーのいないチームでは、メンバーが「リーダーになる」を押せる（運営が決めたリーダーは仮のもの）。
 */
export function TeamPicker({ eventId, event, myRole }: { eventId: string; event: Event; myRole: EventRole | null }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: entries } = useEventEntries(eventId);
  const { data: members } = useEventMembers(eventId, Boolean(me));
  const { data: state } = useEventState(eventId, Boolean(me));
  const api = teamApi(eventId);
  const join = useTeamAction(eventId, api.join);
  const leave = useTeamAction(eventId, api.leave);
  const updateMine = useTeamAction(eventId, api.updateMine);
  const handOver = useTeamAction(eventId, api.handOver);
  const becomeLeader = useTeamAction(eventId, api.becomeLeader);
  if (!event.contestMode || event.participationType !== "team") return null;
  const teams = (entries ?? []).filter((e) => e.kind === "team");
  if (teams.length === 0) return null;
  const membership = findMyMembership(members, me);
  const canChoose = myRole === "participant" && membership?.status === "confirmed";
  const locked = Boolean(state?.scoringLocked);
  const myTeam = me ? teams.find((team) => team.memberUserIds.includes(me.id)) : undefined;
  const nameOf = new Map((members ?? []).map((m) => [m.userId, m.user.globalName ?? m.user.username]));
  const actions = [join, leave, updateMine, handOver, becomeLeader];
  const failed = actions.find((a) => a.isError) ?? null;
  const pending = actions.some((a) => a.isPending);

  return (
    <Card variant="outlined" id="teams" tabIndex={-1} sx={{ scrollMarginTop: 88 }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">{t("teams.chooseTitle")}</Typography>
          <Typography variant="body2" color="text.secondary">
            {!canChoose && myRole !== "staff" ? t("teams.notParticipant") : locked ? t("teams.lockedHelp") : t("teams.chooseHelp")}
          </Typography>
          {failed && <Alert severity="error">{tDynamic(`teams.error_${errorCode(failed.error) ?? "default"}`, t("teams.error_default"))}</Alert>}
          {teams.map((team) => {
            const mine = team.id === myTeam?.id;
            const count = team.memberUserIds.length;
            const full = team.capacity != null && count >= team.capacity;
            return (
              <Box key={team.id} sx={{ border: 1, borderColor: mine ? "primary.main" : "divider", borderWidth: mine ? 2 : 1, borderRadius: 2, p: 1.5 }}>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={700}>{team.name}</Typography>
                    {mine && <Chip size="small" color="primary" label={t("teams.myTeam")} />}
                    <Chip size="small" label={team.capacity == null ? t("teams.members", { count }) : t("teams.membersWithCapacity", { count, capacity: team.capacity })} />
                    {full && !mine && <Chip size="small" color="warning" label={t("teams.full")} />}
                  </Stack>
                  {team.description && <Typography variant="body2" color="text.secondary">{team.description}</Typography>}
                  <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                    {team.memberUserIds.map((userId) => `${nameOf.get(userId) ?? ""}${userId === team.leaderUserId ? `（${t("teams.leaderBadge")}）` : ""}`).join("、")}
                  </Typography>
                  {mine && canChoose && !locked && me && (
                    <MyTeamControls team={team} meId={me.id} nameOf={nameOf} disabled={pending}
                      onUpdate={(input) => updateMine.mutate(input)}
                      onHandOver={(userId) => handOver.mutate(userId)}
                      onBecomeLeader={() => becomeLeader.mutate(undefined)} />
                  )}
                  {canChoose && !locked && (
                    <Box>
                      {mine
                        ? <Button size="small" color="inherit" variant="outlined" disabled={pending} onClick={() => leave.mutate(undefined)}>{t("teams.leave")}</Button>
                        : <Button size="small" variant="contained" disabled={pending || full} onClick={() => join.mutate(team.id)}>{t(myTeam ? "teams.switch" : "teams.join")}</Button>}
                    </Box>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** 自分のチームの中の操作。リーダー: 名前を変える・リーダーを任せる。リーダー不在: リーダーになる */
function MyTeamControls({ team, meId, nameOf, disabled, onUpdate, onHandOver, onBecomeLeader }: {
  team: Entry; meId: string; nameOf: Map<string, string>; disabled: boolean;
  onUpdate: (input: UpdateMyTeamInput) => void; onHandOver: (userId: string) => void; onBecomeLeader: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"none" | "rename" | "handOver">("none");
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [target, setTarget] = useState("");
  const others = team.memberUserIds.filter((userId) => userId !== meId);

  if (team.leaderUserId == null) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary">{t("teams.becomeLeaderHelp")}</Typography>
        <Button size="small" variant="outlined" disabled={disabled} onClick={onBecomeLeader}>{t("teams.becomeLeader")}</Button>
      </Stack>
    );
  }
  if (team.leaderUserId !== meId) return null;

  if (mode === "rename") {
    return (
      <Stack spacing={1}>
        <TextField size="small" label={t("teams.name")} value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: TEAM_NAME_MAX }} />
        <TextField size="small" label={t("teams.description")} value={description} onChange={(e) => setDescription(e.target.value)} inputProps={{ maxLength: TEAM_DESCRIPTION_MAX }} />
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" disabled={disabled || !name.trim()} onClick={() => {
            onUpdate({ name: name.trim(), description: description.trim() });
            setMode("none");
          }}>{t("teams.save")}</Button>
          <Button size="small" color="inherit" onClick={() => setMode("none")}>{t("teams.cancel")}</Button>
        </Stack>
      </Stack>
    );
  }
  if (mode === "handOver") {
    return (
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <TextField select size="small" label={t("teams.handOverTo")} value={target} onChange={(e) => setTarget(e.target.value)} sx={{ minWidth: 200 }}>
          {others.map((userId) => <MenuItem key={userId} value={userId}>{nameOf.get(userId) ?? ""}</MenuItem>)}
        </TextField>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" disabled={disabled || !target} onClick={() => {
            if (!window.confirm(t("teams.handOverConfirm", { name: nameOf.get(target) ?? "" }))) return;
            onHandOver(target);
            setMode("none");
            setTarget("");
          }}>{t("teams.handOver")}</Button>
          <Button size="small" color="inherit" onClick={() => setMode("none")}>{t("teams.cancel")}</Button>
        </Stack>
      </Stack>
    );
  }
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Button size="small" variant="outlined" disabled={disabled} onClick={() => {
        setName(team.name); setDescription(team.description); setMode("rename");
      }}>{t("teams.rename")}</Button>
      {others.length > 0 && (
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => setMode("handOver")}>{t("teams.handOver")}</Button>
      )}
    </Stack>
  );
}
