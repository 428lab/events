import {
  Alert,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import { useEvent, useEventEntries, useMe } from "../api/hooks.js";
import {
  useCriteria,
  useEventState,
  useMyScores,
} from "../api/scoringHooks.js";
import { ScoringPanel } from "../components/ScoringPanel.js";

export function ScoringPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const { data: eventData } = useEvent(id);
  const { data: state } = useEventState(id);
  const { data: entries } = useEventEntries(id);
  const { data: criteria } = useCriteria(id);
  const { data: myScores } = useMyScores(id);

  if (!eventData || !state || !entries || !criteria) {
    return <Typography>読み込み中…</Typography>;
  }

  const role = eventData.myRole;
  if (role !== "judge" && role !== "staff") {
    return <Alert severity="info">採点権限がありません。</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h5" fontWeight={700}>
        採点
      </Typography>
      {state.scoringLocked && (
        <Alert severity="warning">採点は締め切られています。</Alert>
      )}
      {entries.map((entry) => {
        const isSelf = Boolean(me && entry.memberUserIds.includes(me.id));
        const disabled =
          state.scoringLocked ||
          (!eventData.event.aggregateSelfEntry && isSelf);
        return (
          <Card key={entry.id} variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {entry.name}
                {isSelf && (
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 1 }}
                  >
                    （自分）
                  </Typography>
                )}
              </Typography>
              <ScoringPanel
                eventId={id}
                entryId={entry.id}
                criteria={criteria}
                myScores={myScores ?? []}
                disabled={disabled}
              />
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
}
