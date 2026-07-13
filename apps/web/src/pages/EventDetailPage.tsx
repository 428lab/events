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
  Grid,
  Link,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown.js";
import { SchedulePanel } from "../components/SchedulePanel.js";
import { ShareButton } from "../components/ShareButton.js";
import { UserLink } from "../components/UserLink.js";
import type { Entry } from "@eventer/shared";
import {
  eventImageUrl,
  useEvent,
  useEventEntries,
  useEventMembers,
  useEventSlots,
  useJoinEvent,
  useLeaveEvent,
  usePublishEvent,
  useMe,
  useUpdateSubmission,
} from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { useAwards } from "../api/awardHooks.js";
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
  const isMember = Boolean(data?.myRole);
  // アプリ管理者でも、このページでは自分のロールどおりに表示する
  // （他人のイベントでは一般参加者と同じ見え方にする）
  const isStaff = data?.myRole === "staff";
  const { data: members } = useEventMembers(id, true);
  const { data: slots } = useEventSlots(id);
  const { data: entries } = useEventEntries(id);
  const { data: state } = useEventState(id, Boolean(me));
  const { data: awards } = useAwards(id);
  const join = useJoinEvent();
  const leave = useLeaveEvent();
  const publish = usePublishEvent();

  if (isError) {
    return (
      <Alert severity="info">
        このイベントは見つからないか、非公開です。
      </Alert>
    );
  }
  if (isLoading || !data) return <Typography>読み込み中…</Typography>;
  const { event, myRole } = data;
  const community = data.community;

  const myEntry = entries?.find((e) => me && e.memberUserIds.includes(me.id));
  const myMembership = members?.find((m) => me && m.user.id === me.id);
  const hasSlots = Boolean(slots && slots.length > 0);

  const awardItems = awards
    ? [
        // ランキング賞は受賞者が設定されたものだけ。上位（rankOrder 小）から表示。
        ...[...awards.ranks]
          .sort((a, b) => a.rankOrder - b.rankOrder)
          .map((r) => ({
            key: `rank-${r.id}`,
            name: r.name,
            content: r.content,
            result: awards.results.find((x) => x.awardRankId === r.id),
          }))
          .filter((it) => it.result),
        // 特別枠は受賞者なし（該当者なし）も表示する
        ...awards.specials.map((s) => ({
          key: `special-${s.id}`,
          name: s.name,
          content: s.content,
          result: awards.results.find((x) => x.specialAwardId === s.id),
        })),
      ]
    : [];
  // 受賞エントリ→メンバーのアバター解決（個人エントリは1人。なければ頭文字）
  const entryById = new Map((entries ?? []).map((e) => [e.id, e] as const));
  const userById = new Map((members ?? []).map((m) => [m.user.id, m.user] as const));
  const resultAvatarUrl = (result?: { entryId: string }) => {
    const entry = result ? entryById.get(result.entryId) : undefined;
    const uid = entry?.memberUserIds[0];
    return uid ? (userById.get(uid)?.avatarUrl ?? undefined) : undefined;
  };
  const resultUsername = (result?: { entryId: string }) => {
    const entry = result ? entryById.get(result.entryId) : undefined;
    const uid =
      entry && entry.memberUserIds.length === 1
        ? entry.memberUserIds[0]
        : undefined;
    return uid ? userById.get(uid)?.username : undefined;
  };

  const ceremonyDone =
    (state?.awardsRevealCursor ?? 0) >=
    (awards ? awards.ranks.length + awards.specials.length : 0);
  const eventEnded = event.endsAt < Date.now();
  const contest = event.contestMode;
  const showAwards =
    contest && awardItems.length > 0 && (ceremonyDone || eventEnded);

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
        <Stack spacing={3}>
      <Box>
        {community && (
          <Box
            component={RouterLink}
            to={`/c/${community.slug}`}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              mb: 0.5,
              color: "text.secondary",
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            <Avatar
              src={community.iconUrl ?? undefined}
              variant="rounded"
              sx={{ width: 20, height: 20, fontSize: 12 }}
            >
              {community.name.charAt(0)}
            </Avatar>
            <Typography variant="body2">{community.name}</Typography>
          </Box>
        )}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h4" fontWeight={700}>
            {event.title}
          </Typography>
          {event.status !== "published" && (
            <Chip size="small" color="warning" label={event.status} />
          )}
          {myRole && <Chip size="small" label={roleLabel[myRole]} />}
          {event.status === "published" && (
            <ShareButton slug={event.slug} title={event.title} />
          )}
        </Stack>
        <Typography
          variant="h6"
          fontWeight={700}
          sx={{ mt: 1, color: event.scheduling ? "warning.main" : "primary.main" }}
        >
          {event.scheduling
            ? "📅 日程調整中（開催日時は未定）"
            : `📅 ${formatDateRange(event.startsAt, event.endsAt)}`}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {venueLabel[event.venueType]} ・ 参加 {event.participantCount} 人
        </Typography>
      </Box>

      {isStaff && event.status === "draft" && (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={publish.isPending}
              onClick={() => publish.mutate(event.id)}
            >
              公開する
            </Button>
          }
        >
          このイベントは<strong>下書き</strong>です。公開するまで他の人には表示されず、シェアリンクも開けません。
        </Alert>
      )}

      {/* 調整中は常に表示。確定後は候補があり表示オンなら結果を表示（パネル側で判定） */}
      <SchedulePanel
        eventId={event.id}
        isStaff={isStaff}
        anonymous={event.scheduleAnonymous}
        finalized={!event.scheduling}
        visible={event.scheduleVisible}
        eventStartsAt={event.startsAt}
        eventEndsAt={event.endsAt}
      />


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

      {showAwards && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <EmojiEventsIcon color="secondary" />
              <Typography variant="h6">表彰結果</Typography>
            </Stack>
            <Stack spacing={2} divider={<Divider flexItem />}>
              {awardItems.map((it) => (
                <Box key={it.key}>
                  {/* 1行目: 賞の名前 */}
                  <Box sx={{ mb: 1 }}>
                    <Chip
                      label={it.name}
                      color="secondary"
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                  {/* 2行目: 受賞者名 */}
                  {it.result ? (
                    <UserLink
                      username={resultUsername(it.result)}
                      name={it.result.entryName}
                      avatarUrl={resultAvatarUrl(it.result)}
                      withAvatar
                      avatarSize={28}
                      sx={{ fontSize: "1.25rem", fontWeight: 700 }}
                    />
                  ) : (
                    <Typography variant="h6" fontWeight={700} color="text.secondary">
                      該当者なし
                    </Typography>
                  )}
                  {/* 3行目: 賞品 */}
                  {it.content && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      {it.content}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {contest && (eventEnded || state?.scoringLocked) && (
        <Stack direction="row">
          <Button
            variant="outlined"
            component={RouterLink}
            to={`/events/${id}/results`}
          >
            採点結果を見る
          </Button>
        </Stack>
      )}

      {event.description && (
        <Card variant="outlined">
          <CardContent>
            <Markdown>{event.description}</Markdown>
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

      {contest && isMember && state && !state.scoringLocked && (
        <Alert
          severity="info"
          sx={{ alignItems: "center", "& .MuiAlert-message": { flex: 1 } }}
          action={
            <Button
              variant="contained"
              component={RouterLink}
              to={`/events/${id}/scoring`}
            >
              採点する
            </Button>
          }
        >
          採点を受付中です。各チームを採点できます（あとから何度でも変更可）。
        </Alert>
      )}

      {hasSlots && slots && (
        <EventSlots
          eventId={id}
          slots={slots}
          me={me ?? null}
          isMember={isMember}
        />
      )}

      {isMember && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {contest && state && state.mode !== "normal" && (
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
          {contest && state?.mode === "presentation" && (
            <Button
              variant="contained"
              color="error"
              component={RouterLink}
              to={`/events/${id}/present`}
            >
              プレゼン画面へ
            </Button>
          )}
          {contest && state?.mode === "awards" && (
            <Button
              variant="contained"
              color="secondary"
              component={RouterLink}
              to={`/events/${id}/awards`}
            >
              表彰式へ
            </Button>
          )}
          {contest && (
            <Button variant="outlined" component={RouterLink} to={`/events/${id}/scoring`}>
              採点
            </Button>
          )}
          {isStaff && (
            <Button variant="contained" component={RouterLink} to={`/events/${id}/edit`}>
              編集
            </Button>
          )}
          {isStaff && (
            <Button
              variant="outlined"
              component={RouterLink}
              to={`/events/${id}/live/control`}
            >
              🎬 配信
            </Button>
          )}
          {contest && isStaff && (
            <>
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

      {contest && myEntry && <SubmissionEditor eventId={id} entry={myEntry} />}

      {contest &&
        (event.venueType === "online" || event.venueType === "hybrid") &&
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
                  <ListItemButton
                    key={m.id}
                    disableGutters
                    component={RouterLink}
                    to={`/users/${m.user.username}`}
                  >
                    <ListItemAvatar>
                      <Avatar
                        src={m.user.avatarUrl ?? undefined}
                        alt={m.user.globalName ?? m.user.username}
                      >
                        {(m.user.globalName ?? m.user.username).charAt(0)}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={m.user.globalName ?? m.user.username}
                      secondary={roleLabel[m.role]}
                    />
                  </ListItemButton>
                ))}
              </List>
            </CardContent>
          </Card>
        )}
      </Grid>
    </Grid>
  );
}
