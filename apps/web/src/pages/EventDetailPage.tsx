import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { Entry } from "@eventer/shared";
import {
  useEvent,
  useEventEntries,
  useEventMembers,
  useJoinEvent,
  useLeaveEvent,
  useMe,
  usePublishEvent,
  useUpdateSubmission,
} from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { formatDateRange, roleLabel, venueLabel } from "../lib/format.js";

function SubmissionEditor({ eventId, entry }: { eventId: string; entry: Entry }) {
  const update = useUpdateSubmission(eventId);
  const [presentationUrl, setPresentationUrl] = useState(
    entry.submission?.presentationUrl ?? "",
  );
  const [sourceCodeUrl, setSourceCodeUrl] = useState(
    entry.submission?.sourceCodeUrl ?? "",
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          あなたの成果物
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="プレゼン資料 URL"
            value={presentationUrl}
            onChange={(e) => setPresentationUrl(e.target.value)}
            fullWidth
          />
          <TextField
            label="ソースコード URL"
            value={sourceCodeUrl}
            onChange={(e) => setSourceCodeUrl(e.target.value)}
            fullWidth
          />
          {update.isError && (
            <Alert severity="error">保存に失敗しました（URL 形式を確認）</Alert>
          )}
          {update.isSuccess && <Alert severity="success">保存しました</Alert>}
          <Box>
            <Button
              variant="contained"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  entryId: entry.id,
                  input: { presentationUrl, sourceCodeUrl },
                })
              }
            >
              保存
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EventDetailPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const { data, isLoading } = useEvent(id);
  const isMember = Boolean(data?.myRole);
  const isStaff = data?.myRole === "staff";
  const { data: members } = useEventMembers(id, isMember);
  const { data: entries } = useEventEntries(id);
  const { data: state } = useEventState(id);
  const join = useJoinEvent();
  const leave = useLeaveEvent();
  const publish = usePublishEvent();

  if (isLoading || !data) return <Typography>読み込み中…</Typography>;
  const { event, myRole } = data;

  const myEntry = entries?.find((e) => me && e.memberUserIds.includes(me.id));

  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h4" fontWeight={700}>
            {event.title}
          </Typography>
          {event.status !== "published" && (
            <Chip size="small" color="warning" label={event.status} />
          )}
          {myRole && <Chip size="small" label={roleLabel[myRole]} />}
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {formatDateRange(event.startsAt, event.endsAt)} ・{" "}
          {venueLabel[event.venueType]}
        </Typography>
      </Box>

      {event.description && (
        <Card variant="outlined">
          <CardContent>
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              {event.description}
            </Typography>
            {event.venueOffline && (
              <Typography variant="body2" sx={{ mt: 2 }}>
                会場: {event.venueOffline}
              </Typography>
            )}
            {event.venueOnline && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                オンライン:{" "}
                <Link href={event.venueOnline} target="_blank" rel="noreferrer">
                  {event.venueOnline}
                </Link>
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      <Stack direction="row" spacing={2}>
        {!isMember ? (
          <Button
            variant="contained"
            disabled={join.isPending}
            onClick={() => join.mutate(id)}
          >
            参加登録する
          </Button>
        ) : (
          <Button
            variant="outlined"
            color="error"
            disabled={leave.isPending}
            onClick={() => leave.mutate(id)}
          >
            参加を解除する
          </Button>
        )}
        {isStaff && event.status !== "published" && (
          <Button
            variant="outlined"
            disabled={publish.isPending}
            onClick={() => publish.mutate(id)}
          >
            公開する
          </Button>
        )}
      </Stack>

      {isMember && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {state && state.mode !== "normal" && (
            <Chip
              color={state.mode === "presentation" ? "error" : "primary"}
              label={`進行中: ${
                state.mode === "presentation"
                  ? "プレゼン"
                  : state.mode === "aggregation"
                    ? "集計"
                    : "表彰"
              }`}
            />
          )}
          {state?.mode === "presentation" && (
            <Button
              variant="contained"
              color="error"
              component={RouterLink}
              to={`/events/${id}/present`}
            >
              プレゼン画面へ
            </Button>
          )}
          {(myRole === "judge" || myRole === "staff") && (
            <Button variant="outlined" component={RouterLink} to={`/events/${id}/scoring`}>
              採点
            </Button>
          )}
          {isStaff && (
            <>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/control`}>
                進行コントロール
              </Button>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/criteria`}>
                採点項目
              </Button>
            </>
          )}
        </Stack>
      )}

      {myEntry && <SubmissionEditor eventId={id} entry={myEntry} />}

      {isMember && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              参加者一覧
            </Typography>
            <List dense>
              {members?.map((m) => (
                <ListItem key={m.id} disableGutters>
                  <ListItemText
                    primary={m.user.globalName ?? m.user.username}
                    secondary={roleLabel[m.role]}
                  />
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      )}

      {(event.venueType === "online" || event.venueType === "hybrid") &&
        entries && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                成果物一覧
              </Typography>
              <Divider sx={{ mb: 1 }} />
              <List dense>
                {entries
                  .filter((e) => e.submission)
                  .map((e) => (
                    <ListItem key={e.id} disableGutters>
                      <ListItemText
                        primary={e.name}
                        secondary={
                          <>
                            {e.submission?.presentationUrl && (
                              <Link
                                href={e.submission.presentationUrl}
                                target="_blank"
                                rel="noreferrer"
                                sx={{ mr: 2 }}
                              >
                                資料
                              </Link>
                            )}
                            {e.submission?.sourceCodeUrl && (
                              <Link
                                href={e.submission.sourceCodeUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                コード
                              </Link>
                            )}
                          </>
                        }
                      />
                    </ListItem>
                  ))}
              </List>
            </CardContent>
          </Card>
        )}
    </Stack>
  );
}
