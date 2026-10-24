import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { Event, EventRole } from "@eventer/shared";
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
  if (!event.contestMode || event.participationType !== "team") return null;
  const teams = (entries ?? []).filter((e) => e.kind === "team");
  if (teams.length === 0) return null;
  const membership = findMyMembership(members, me);
  const canChoose = myRole === "participant" && membership?.status === "confirmed";
  const locked = Boolean(state?.scoringLocked);
  const myTeam = me ? teams.find((team) => team.memberUserIds.includes(me.id)) : undefined;
  const nameOf = new Map((members ?? []).map((m) => [m.userId, m.user.globalName ?? m.user.username]));
  const failed = join.isError ? join : leave.isError ? leave : null;
  const pending = join.isPending || leave.isPending;

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
