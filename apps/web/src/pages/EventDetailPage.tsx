import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
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
  eventImageUrl,
  useEvent,
  useEventEntries,
  useEventMembers,
  useEventSlots,
  useJoinEvent,
  useLeaveEvent,
  useIsAdmin,
  useMe,
  useUpdateSubmission,
} from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { EventSlots } from "../components/EventSlots.js";
import { formatDateRange, roleLabel, venueLabel } from "../lib/format.js";

const STATUS_LABEL: Record<string, string> = {
  confirmed: "確定",
  waitlist: "キャンセル待ち",
  applied: "抽選申込中",
  lost: "落選",
};

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
  const { data, isLoading, isError } = useEvent(id);
  const isAdmin = useIsAdmin();
  const isMember = Boolean(data?.myRole);
  const isStaff = data?.myRole === "staff" || isAdmin;
  const { data: members } = useEventMembers(id, true);
  const { data: slots } = useEventSlots(id);
  const { data: entries } = useEventEntries(id);
  const { data: state } = useEventState(id, Boolean(me));
  const join = useJoinEvent();
  const leave = useLeaveEvent();

  if (isError) {
    return (
      <Alert severity="info">
        このイベントは見つからないか、非公開です。
      </Alert>
    );
  }
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;
  const { event, myRole } = data;

  const myEntry = entries?.find((e) => me && e.memberUserIds.includes(me.id));
  const myMembership = members?.find((m) => me && m.user.id === me.id);
  const hasSlots = Boolean(slots && slots.length > 0);

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
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
          {venueLabel[event.venueType]} ・ 参加 {event.participantCount} 人
        </Typography>
      </Box>

      {eventImageUrl(event) && (
        <Box
          component="img"
          src={eventImageUrl(event)!}
          alt={event.title}
          sx={{
            width: "100%",
            aspectRatio: "1200 / 630",
            objectFit: "cover",
            borderRadius: 2,
          }}
        />
      )}

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

      <Stack direction="row" spacing={2} alignItems="center">
        {!me ? (
          <Button variant="contained" component={RouterLink} to="/login">
            ログインして参加
          </Button>
        ) : isMember ? (
          <>
            {myMembership && myRole === "participant" && (
              <Chip
                color={myMembership.status === "confirmed" ? "success" : "default"}
                label={`参加状態: ${STATUS_LABEL[myMembership.status] ?? myMembership.status}`}
              />
            )}
            <Button
              variant="outlined"
              color="error"
              disabled={leave.isPending}
              onClick={() => leave.mutate(id)}
            >
              参加を解除する
            </Button>
          </>
        ) : !hasSlots ? (
          <Button
            variant="contained"
            disabled={join.isPending}
            onClick={() => join.mutate({ id })}
          >
            参加登録する
          </Button>
        ) : null}
      </Stack>

      {hasSlots && slots && (
        <EventSlots
          eventId={id}
          slots={slots}
          me={me ?? null}
          isMember={isMember}
        />
      )}

      {(isMember || isAdmin) && (
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
          {state?.mode === "awards" && (
            <Button
              variant="contained"
              color="secondary"
              component={RouterLink}
              to={`/events/${id}/awards`}
            >
              表彰式へ
            </Button>
          )}
          {(myRole === "judge" || myRole === "staff" || isAdmin) && (
            <Button variant="outlined" component={RouterLink} to={`/events/${id}/scoring`}>
              採点
            </Button>
          )}
          {isStaff && (
            <>
              <Button variant="contained" component={RouterLink} to={`/events/${id}/edit`}>
                編集
              </Button>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/control`}>
                進行コントロール
              </Button>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/criteria`}>
                採点項目
              </Button>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/awards`}>
                表彰式
              </Button>
            </>
          )}
        </Stack>
      )}

      {myEntry && <SubmissionEditor eventId={id} entry={myEntry} />}

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
      </Grid>

      <Grid item xs={12} md={4}>
        {members && (
          <Card
            variant="outlined"
            sx={{ position: { md: "sticky" }, top: { md: 16 } }}
          >
            <CardContent>
              <Typography variant="h6" gutterBottom>
                参加者一覧（{members.length}）
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
      </Grid>
    </Grid>
  );
}
