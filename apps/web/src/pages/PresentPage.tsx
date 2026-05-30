import {
  Avatar,
  AvatarGroup,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import {
  useEvent,
  useEventEntries,
  useEventMembers,
  useIsAdmin,
  useMe,
} from "../api/hooks.js";
import {
  useCriteria,
  useEventState,
  useMyScores,
} from "../api/scoringHooks.js";
import { ScoringPanel } from "../components/ScoringPanel.js";

export function PresentPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const isAdmin = useIsAdmin();
  const { data: eventData } = useEvent(id);
  const { data: state } = useEventState(id);
  const { data: entries } = useEventEntries(id);
  const { data: members } = useEventMembers(id, true);
  const { data: criteria } = useCriteria(id);
  const { data: myScores } = useMyScores(id);

  if (!eventData || !state || !entries || !criteria) {
    return <Typography>読み込み中…</Typography>;
  }

  const role = eventData.myRole;
  const presenting = entries.find((e) => e.id === state.presentingEntryId);
  // 発表チームのメンバーを user レコード（アイコンURL付き）から引く
  const presentingMembers = presenting
    ? presenting.memberUserIds.map((uid) => {
        const m = members?.find((mm) => mm.user.id === uid);
        return {
          id: uid,
          name: m?.user.globalName ?? m?.user.username ?? "?",
          avatarUrl: m?.user.avatarUrl ?? undefined,
        };
      })
    : [];
  const canScore = role === "judge" || role === "staff" || isAdmin;
  const isSelf = presenting
    ? Boolean(me && presenting.memberUserIds.includes(me.id))
    : false;
  const scoringDisabled =
    state.scoringLocked ||
    (!eventData.event.aggregateSelfEntry && isSelf);

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={canScore ? 7 : 12}>
        <Stack spacing={2}>
          <Chip color="error" label="プレゼンモード" sx={{ alignSelf: "flex-start" }} />
          {presenting ? (
            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  発表中
                </Typography>
                <Stack direction="row" spacing={2} alignItems="center">
                  <AvatarGroup max={6} sx={{ "& .MuiAvatar-root": { width: 64, height: 64, fontSize: 28 } }}>
                    {presentingMembers.map((m) => (
                      <Avatar key={m.id} src={m.avatarUrl} alt={m.name}>
                        {m.name.charAt(0)}
                      </Avatar>
                    ))}
                  </AvatarGroup>
                  <Typography variant="h3" fontWeight={700}>
                    {presenting.name}
                  </Typography>
                </Stack>
                {presentingMembers.length > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {presentingMembers.map((m) => m.name).join("、")}
                  </Typography>
                )}
                {presenting.submission?.presentationUrl && (
                  <Typography sx={{ mt: 2 }}>
                    資料:{" "}
                    <Link
                      href={presenting.submission.presentationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {presenting.submission.presentationUrl}
                    </Link>
                  </Typography>
                )}
                {presenting.submission?.sourceCodeUrl && (
                  <Typography>
                    コード:{" "}
                    <Link
                      href={presenting.submission.sourceCodeUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {presenting.submission.sourceCodeUrl}
                    </Link>
                  </Typography>
                )}
              </CardContent>
            </Card>
          ) : (
            <Box sx={{ py: 6, textAlign: "center" }}>
              <Typography variant="h5" color="text.secondary">
                発表チームの選択を待っています…
              </Typography>
            </Box>
          )}
        </Stack>
      </Grid>

      {canScore && (
        <Grid item xs={12} md={5}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                採点
              </Typography>
              {presenting ? (
                <ScoringPanel
                  eventId={id}
                  entryId={presenting.id}
                  criteria={criteria}
                  myScores={myScores ?? []}
                  disabled={scoringDisabled}
                />
              ) : (
                <Typography color="text.secondary">
                  発表チームが選択されると採点できます
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      )}
    </Grid>
  );
}
