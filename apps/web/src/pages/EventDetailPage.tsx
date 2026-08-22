import { Suspense, lazy, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  Grid,
  Link,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import BarChartIcon from "@mui/icons-material/BarChart";
import CampaignIcon from "@mui/icons-material/Campaign";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottom";
import CheckIcon from "@mui/icons-material/Check";
import EggIcon from "@mui/icons-material/Egg";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import LockIcon from "@mui/icons-material/Lock";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import BadgeIcon from "@mui/icons-material/Badge";
import { IconButton, Menu, MenuItem } from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown.js";
import { SchedulePanel } from "../components/SchedulePanel.js";
import { ShareButton } from "../components/ShareButton.js";
import { UserLink } from "../components/UserLink.js";
import type { Entry, EventMemberWithUser, EventRole } from "@eventer/shared";
import { EVENT_ROLES } from "@eventer/shared";
import { useSetEventMemberRole } from "../api/hooks.js";
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
  useSetAttendance,
  useUpdateSubmission,
} from "../api/hooks.js";
import { useEventState } from "../api/scoringHooks.js";
import { useEventSurvey } from "../api/eventSurveyHooks.js";
import { SurveyAnswerDialog } from "../components/SurveyAnswerDialog.js";
import { ApiError } from "../api/client.js";
import { errorMessage } from "../lib/errorMessage.js";
import { i18next, tDynamic } from "../i18n/index.js";
import { EventPhotos } from "../components/EventPhotos.js";
import { EventComments } from "../components/EventComments.js";
import { EventSchedule } from "../components/EventSchedule.js";
import { EventMaterials } from "../components/EventMaterials.js";
import { EventFeedback } from "../components/EventFeedback.js";
import { EventQa } from "../components/EventQa.js";
import { useRecordView } from "../api/analyticsHooks.js";
import { useAwards } from "../api/awardHooks.js";
import { EventSlots } from "../components/EventSlots.js";
import { OfferVenueButton, VenueOfferPanel } from "../components/VenueOffers.js";
import { EntranceQrDialog } from "../components/EntranceQrDialog.js";
import { EventStaffInvitesCard } from "../components/EventStaffInvitesCard.js";
import {
  formatDateRange,
  formatDateTime,
  formatRemaining,
  participantCountLabel,
  roleLabel,
  venueLabel,
} from "../lib/format.js";

/** Nostrチャット (#199)。nostr-tools（暗号ライブラリ）が大きいため遅延読み込みで分離する */
const EventChat = lazy(() =>
  import("../components/EventChat.js").then((m) => ({ default: m.EventChat })),
);

/** 申込の状態 → 翻訳キー。知らない値はそのまま出す（サーバーが増やしても壊れない） */
const STATUS_KEY: Record<string, string> = {
  confirmed: "statusConfirmed",
  waitlist: "statusWaitlist",
  applied: "statusApplied",
  lost: "statusLost",
};

function statusLabel(status: string): string {
  const key = STATUS_KEY[status];
  return key ? tDynamic(`eventDetail.${key}`, status) : status;
}

function SubmissionEditor({ eventId, entry }: { eventId: string; entry: Entry }) {
  const { t } = useTranslation();
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
          {t("eventDetail.mySubmission")}
        </Typography>
        <Stack spacing={2}>
          <TextField
            label={t("eventDetail.presentationUrl")}
            value={presentationUrl}
            onChange={(e) => setPresentationUrl(e.target.value)}
            fullWidth
          />
          <TextField
            label={t("eventDetail.sourceCodeUrl")}
            value={sourceCodeUrl}
            onChange={(e) => setSourceCodeUrl(e.target.value)}
            fullWidth
          />
          {update.isError && (
            <Alert severity="error">
              {t("eventDetail.submissionSaveFailed")}
            </Alert>
          )}
          {update.isSuccess && (
            <Alert severity="success">{t("eventDetail.submissionSaved")}</Alert>
          )}
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
              {t("common.save")}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function EventDetailPage() {
  const { t } = useTranslation();
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
  // 事前アンケート (#152)。質問があれば参加前に回答ダイアログを挟む
  const { data: surveyQuestions } = useEventSurvey(id);
  const hasSurvey = (surveyQuestions?.length ?? 0) > 0;
  const [surveyOpen, setSurveyOpen] = useState(false);
  // 回答後に続行する参加操作（null = 参加ではなく回答の編集）
  const [pendingJoin, setPendingJoin] = useState<{ slotId?: string } | null>(
    null,
  );
  // 入場QR（受付チェックイン用チケット） (#154)
  const [entranceQrOpen, setEntranceQrOpen] = useState(false);
  // 参加できなかった理由の表示（締切/終了）。押しても何も起きない状態を作らない (#269)
  const [joinError, setJoinError] = useState("");
  // 募集締切の残り時間を動かすための時計 (#269)。開いたままのページでも
  // 締切をまたいだら表示が「募集は締め切りました」に切り替わるよう1分ごとに進める。
  // 秒単位で刻む必要はない（表示の粒度が分・時間なので）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const qc = useQueryClient();

  const doJoin = (slotId?: string) =>
    join.mutate(
      { id, ...(slotId ? { slotId } : {}) },
      {
        onSuccess: () => setJoinError(""),
        onError: (err) => {
          const code =
            err instanceof ApiError
              ? (err.body as { error?: string } | null)?.error
              : undefined;
          // サーバー側の必須アンケート未回答 (409 survey_required) はダイアログで回答してもらう
          if (code === "survey_required") {
            // ページ読込後に質問が追加されたケースに備え、最新の質問を取得してから開く
            void qc.invalidateQueries({ queryKey: ["event", id, "survey"] });
            setPendingJoin({ slotId });
            setSurveyOpen(true);
            return;
          }
          // 締切前に開いたまま放置されたページからの参加 (#269)。ボタンはまだ
          // 有効なので押せてしまうが、サーバーは 409 で断る。理由を出したうえで
          // イベントを取り直し、締切後の表示（募集は締め切りました）に切り替える。
          // event_ended も同じ経路（開いたまま終了時刻をまたいだ）なので一緒に扱う
          if (code === "registration_closed" || code === "event_ended") {
            setJoinError(
              t(
                code === "registration_closed"
                  ? "eventDetail.joinClosedError"
                  : "eventDetail.joinEndedError",
              ),
            );
            setSurveyOpen(false);
            setPendingJoin(null);
            setNow(Date.now());
            void qc.invalidateQueries({ queryKey: ["event", id] });
          }
        },
      },
    );

  /** 参加操作の入口。アンケートがあれば先に回答ダイアログを開く */
  const requestJoin = (slotId?: string) => {
    setJoinError("");
    if (hasSurvey) {
      setPendingJoin({ slotId });
      setSurveyOpen(true);
    } else {
      doJoin(slotId);
    }
  };
  // 公開イベントの表示を記録（サーバー側で下書き・主催者/管理者は除外）
  useRecordView(id, data?.event.status === "published");

  if (isError) {
    return <Alert severity="info">{t("eventDetail.notFound")}</Alert>;
  }
  if (isLoading || !data)
    return <Typography>{t("common.loading")}</Typography>;
  const { event, myRole, membersNote } = data;
  const community = data.community;
  const fromRequests = data.fromRequests ?? [];

  const myEntry = entries?.find((e) => me && e.memberUserIds.includes(me.id));
  const myMembership = members?.find((m) => me && m.user.id === me.id);
  // コメント投稿は参加確定者のみ（メンバー一覧の読込前は myRole の有無で仮判定）
  const canComment = myMembership
    ? myMembership.status === "confirmed"
    : Boolean(myRole);
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
  // 日程調整中（endsAt未確定=0）は終了扱いしない（サーバー側 isEventEnded と同じ判定）。
  // now は1分ごとに進むので、開いたままのページでも終了・締切をまたげば表示が切り替わる
  const eventEnded = !event.scheduling && event.endsAt < now;
  // 募集締切 (#269)。未設定（null）なら締切なしで、従来どおり終了まで受け付ける。
  // サーバー側 isRegistrationClosed と同じ判定
  const deadline = event.registrationDeadline;
  const registrationClosed = deadline !== null && deadline <= now;
  // 締切24時間前を切ったら残り時間を強調して申し込みを促す
  const deadlineRemaining =
    deadline !== null && !registrationClosed && deadline - now < 86400000
      ? formatRemaining(deadline, now)
      : "";
  const contest = event.contestMode;
  const showAwards =
    contest && awardItems.length > 0 && (ceremonyDone || eventEnded);

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
        <Stack spacing={3}>
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
              sx={{ width: 20, height: 20, fontSize: 12, borderRadius: "5px" }}
            >
              {community.name.charAt(0)}
            </Avatar>
            <Typography variant="body2">{community.name}</Typography>
          </Box>
        )}
        {/* 生まれ元のたまご（あったらいいな）への逆リンク */}
        {fromRequests.map((r) => (
          <Box
            key={r.id}
            component={RouterLink}
            to={`/requests/${r.id}`}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              mb: 0.5,
              color: "text.secondary",
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            <Typography
              variant="body2"
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <EggIcon fontSize="inherit" />
              {t("eventDetail.fromRequest", { title: r.title })}
            </Typography>
          </Box>
        ))}
        <Typography variant="h5" fontWeight={700}>
          {event.title}
        </Typography>
        {event.subtitle && (
          <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 0.5 }}>
            {event.subtitle}
          </Typography>
        )}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 1 }}
        >
          {event.status !== "published" && (
            <Chip size="small" color="warning" label={event.status} />
          )}
          {myRole && <Chip size="small" label={roleLabel(myRole)} />}
          {event.status === "published" && (
            <ShareButton slug={event.slug} title={event.title} />
          )}
        </Stack>
        <Typography
          variant="h6"
          fontWeight={700}
          sx={{
            mt: 1,
            color: event.scheduling
              ? (theme) =>
                  theme.palette.mode === "light"
                    ? theme.palette.warning.dark
                    : theme.palette.warning.main
              : "primary.main",
            display: "flex",
            alignItems: "center",
            gap: 0.75,
          }}
        >
          <CalendarMonthIcon fontSize="small" />
          {event.scheduling
            ? t("eventDetail.schedulingTbd")
            : formatDateRange(event.startsAt, event.endsAt)}
        </Typography>
        {/* 募集締切 (#269)。設定されているときだけ出す（未設定は従来の見た目のまま） */}
        {deadline !== null && (
          <Typography
            variant="body2"
            sx={{
              mt: 0.5,
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              // 締切間近は目に留まるように強調。締切後は落ち着いた色に戻す
              color: registrationClosed
                ? "text.secondary"
                : deadlineRemaining
                  ? (theme) =>
                      theme.palette.mode === "light"
                        ? theme.palette.warning.dark
                        : theme.palette.warning.main
                  : "text.secondary",
              fontWeight: deadlineRemaining ? 700 : 400,
            }}
          >
            <HourglassBottomIcon fontSize="small" />
            {t("eventDetail.deadlineAt", { date: formatDateTime(deadline) })}
            {registrationClosed
              ? t("eventDetail.deadlineClosedSuffix")
              : deadlineRemaining
                ? t("eventDetail.deadlineRemainingSuffix", {
                    remaining: deadlineRemaining,
                  })
                : ""}
          </Typography>
        )}
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {/* 区切りの記号は言語で変わるので辞書が持つ (#363) */}
          {venueLabel(event.venueType)}
          {t("common.dotSeparator")}
          {participantCountLabel(event)}
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
              {t("eventDetail.publish")}
            </Button>
          }
        >
          <Trans
            i18nKey="eventDetail.draftNotice"
            components={{ b: <strong /> }}
          />
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



      {showAwards && (
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <EmojiEventsIcon color="secondary" />
              <Typography variant="h6">
                {t("eventDetail.awardsHeading")}
              </Typography>
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
                      {t("eventDetail.noRecipient")}
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
            {t("eventDetail.viewResults")}
          </Button>
        </Stack>
      )}

      {event.description && (
        <Card variant="outlined">
          <CardContent>
            <Markdown>{event.description}</Markdown>
            {event.venueOffline && (
              <Typography variant="body2" sx={{ mt: 2 }}>
                {t("eventDetail.venueOffline", { venue: event.venueOffline })}
              </Typography>
            )}
            {event.venueOnline && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t("eventDetail.venueOnline")}{" "}
                <Link href={event.venueOnline} target="_blank" rel="noreferrer">
                  {event.venueOnline}
                </Link>
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {/* タイムテーブル（閲覧はイベントが見える人全員、編集は staff） */}
      <EventSchedule
        eventId={id}
        eventStartsAt={event.scheduling ? null : event.startsAt}
        isStaff={isStaff}
      />

      {/* 登壇資料ギャラリー（資料URLのあるコマだけ。無ければ非表示） */}
      <EventMaterials eventId={id} />

      {/* いいねフィードバック (#155)。参加確定メンバー＋開始後のみ表示 */}
      <EventFeedback
        eventId={id}
        event={event}
        community={community}
        canLike={canComment}
      />

      {/* 参加者チャット (#199)。確定メンバー＋公開＋日程確定のみ。本文はNostrリレー直通 */}
      {canComment &&
        event.chatEnabled &&
        !event.scheduling &&
        event.startsAt > 0 &&
        event.status === "published" && (
          <Suspense fallback={null}>
            <EventChat
              eventId={id}
              event={event}
              myRole={myRole}
              canChat={canComment}
            />
          </Suspense>
        )}

      {/* Q&A (#216)。確定メンバーのみ。表示は QaQuestionList に切り出してあり
          投影用画面・プレゼンターのサイドパネル (#215) から再利用する */}
      {canComment && event.qaEnabled && (
        <EventQa eventId={id} canPost={canComment} />
      )}

      {/* 参加者限定のお知らせ（サーバーが閲覧可の人にだけ返す） */}
      {membersNote && (
        <Card variant="outlined" sx={{ borderColor: "warning.main" }}>
          <CardContent>
            <Typography
              variant="h6"
              sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}
            >
              <LockIcon
              fontSize="small"
              sx={{
                color: (theme) =>
                  theme.palette.mode === "light"
                    ? theme.palette.warning.dark
                    : theme.palette.warning.main,
              }}
            />
              {t("eventDetail.membersNoteHeading")}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1 }}
            >
              {t("eventDetail.membersNoteCaption")}
            </Typography>
            <Markdown>{membersNote}</Markdown>
          </CardContent>
        </Card>
      )}

      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        {/* 参加状態のバッジは終了後も表示（参加履歴として残す） */}
        {isMember && myMembership && myRole === "participant" && (
          <Chip
            color={myMembership.status === "confirmed" ? "success" : "default"}
            label={t("eventDetail.myStatus", {
              status: statusLabel(myMembership.status),
            })}
          />
        )}
        {/* 入場QR (#154)。出席チェックモード＋日程確定済みの確定参加者に表示 */}
        {me &&
          myMembership?.status === "confirmed" &&
          event.attendanceCheck &&
          !event.scheduling &&
          !eventEnded && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<QrCode2Icon />}
              onClick={() => setEntranceQrOpen(true)}
            >
              {t("eventDetail.entranceQr")}
            </Button>
          )}
        {/* 参加後もアンケート回答を見直せる (#152) */}
        {isMember && hasSurvey && (
          <Button
            size="small"
            onClick={() => {
              setPendingJoin(null);
              setSurveyOpen(true);
            }}
          >
            {t("eventDetail.editSurveyAnswers")}
          </Button>
        )}
        {eventEnded ? (
          <Chip variant="outlined" label={t("eventDetail.endedChip")} />
        ) : /* 締切後は新規登録だけを止める。既存参加者の解除ボタンは下で出す (#269)。
             未ログインの訪問者にも「ログインして参加」ではなくこの表示を出すのは意図的で、
             ログインしたところで参加できない以上、先に締切を伝えるほうが親切なため */
        registrationClosed && !isMember ? (
          <Chip variant="outlined" label={t("eventDetail.closedChip")} />
        ) : !me ? (
          <Button variant="contained" component={RouterLink} to="/login">
            {t("eventDetail.loginToJoin")}
          </Button>
        ) : isMember ? (
          <Button
            variant="outlined"
            color="error"
            disabled={leave.isPending}
            onClick={() => leave.mutate(id)}
          >
            {t("eventDetail.leave")}
          </Button>
        ) : !hasSlots ? (
          <Button
            variant="contained"
            disabled={join.isPending}
            onClick={() => requestJoin()}
          >
            {t("eventDetail.register")}
          </Button>
        ) : null}
      </Stack>

      {/* 参加できなかった理由 (#269)。締切・終了をまたいだページから押したとき、
          無反応にせずここで理由を出す。表示自体は invalidate 後の再描画で
          締切後のものに切り替わる */}
      {joinError && (
        <Alert severity="warning" onClose={() => setJoinError("")}>
          {joinError}
        </Alert>
      )}

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
              {t("eventDetail.scoreNow")}
            </Button>
          }
        >
          {t("eventDetail.scoringOpen")}
        </Alert>
      )}

      {hasSlots && slots && (
        <EventSlots
          slots={slots}
          me={me ?? null}
          isMember={isMember}
          ended={eventEnded}
          closed={registrationClosed}
          joinPending={join.isPending}
          onJoin={(slotId) => requestJoin(slotId)}
        />
      )}

      {/* 入場QRダイアログ (#154)。開いている間だけチケットを取得・自動更新 */}
      {me && entranceQrOpen && (
        <EntranceQrDialog
          eventId={id}
          user={me}
          open={entranceQrOpen}
          onClose={() => setEntranceQrOpen(false)}
        />
      )}

      {/* 事前アンケートの回答ダイアログ（参加前の回答／参加後の編集に共用） */}
      {me && surveyQuestions && (hasSurvey || surveyOpen) && (
        <SurveyAnswerDialog
          eventId={id}
          questions={surveyQuestions}
          open={surveyOpen}
          onClose={() => setSurveyOpen(false)}
          onSubmitted={
            pendingJoin ? () => doJoin(pendingJoin.slotId) : undefined
          }
          submitLabel={t(
            pendingJoin
              ? "eventDetail.surveySubmitJoin"
              : "eventDetail.surveySubmitSave",
          )}
        />
      )}

      {isMember && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {contest && state && state.mode !== "normal" && (
            <Chip
              color={state.mode === "presentation" ? "error" : "primary"}
              label={t("eventDetail.modeRunning", {
                mode: t(
                  state.mode === "presentation"
                    ? "eventDetail.modePresentation"
                    : state.mode === "aggregation"
                      ? "eventDetail.modeAggregation"
                      : "eventDetail.modeAwards",
                ),
              })}
            />
          )}
          {contest && state?.mode === "presentation" && (
            <Button
              variant="contained"
              color="error"
              component={RouterLink}
              to={`/events/${id}/present`}
            >
              {t("eventDetail.toPresentation")}
            </Button>
          )}
          {contest && state?.mode === "awards" && (
            <Button
              variant="contained"
              color="secondary"
              component={RouterLink}
              to={`/events/${id}/awards`}
            >
              {t("eventDetail.toAwards")}
            </Button>
          )}
          {contest && (
            <Button variant="outlined" component={RouterLink} to={`/events/${id}/scoring`}>
              {t("eventDetail.scoring")}
            </Button>
          )}
          {isStaff && (
            <Button variant="contained" component={RouterLink} to={`/events/${id}/edit`}>
              {t("common.edit")}
            </Button>
          )}
          {isStaff && (
            <Button
              variant="outlined"
              startIcon={<LiveTvIcon />}
              component={RouterLink}
              to={`/events/${id}/live/control`}
            >
              {t("eventDetail.live")}
            </Button>
          )}
          {isStaff && (
            <Button
              variant="outlined"
              startIcon={<CampaignIcon />}
              component={RouterLink}
              to={`/events/${id}/broadcast`}
            >
              {t("eventDetail.broadcast")}
            </Button>
          )}
          {/* 準備の段取り (#393)。スタッフ専用の独立ページへの導線 */}
          {isStaff && (
            <Button
              variant="outlined"
              startIcon={<ChecklistIcon />}
              component={RouterLink}
              to={`/events/${id}/todos`}
            >
              {t("staffOps.todoTitle")}
            </Button>
          )}
          {/* スタッフチャット (#382)。公開前から使える運営専用の部屋。
              myRole === "staff" のときだけ描画（isAdmin は混ぜない #275） */}
          {isStaff && (
            <Button
              variant="outlined"
              startIcon={<ForumOutlinedIcon />}
              component={RouterLink}
              to={`/events/${id}/staff-chat`}
            >
              {t("staffOps.staffChatTitle")}
            </Button>
          )}
          {/* 役割と持ち場 (#384)。スタッフ専用の独立ページへの導線 */}
          {isStaff && (
            <Button
              variant="outlined"
              startIcon={<AssignmentIndOutlinedIcon />}
              component={RouterLink}
              to={`/events/${id}/staffing`}
            >
              {t("staffOps.dutyTitle")}
            </Button>
          )}
          {isStaff && (
            <Button
              variant="outlined"
              startIcon={<BarChartIcon />}
              component={RouterLink}
              to={`/events/${id}/stats`}
            >
              {t("eventDetail.stats")}
            </Button>
          )}
          {isStaff && event.attendanceCheck && (
            <Button
              variant="outlined"
              startIcon={<QrCodeScannerIcon />}
              component={RouterLink}
              to={`/events/${id}/checkin`}
            >
              {t("eventDetail.checkin")}
            </Button>
          )}
          {isStaff && (
            <Button
              variant="outlined"
              startIcon={<BadgeIcon />}
              component={RouterLink}
              to={`/events/${id}/name-cards`}
            >
              {t("eventDetail.nameCards")}
            </Button>
          )}
          {contest && isStaff && (
            <>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/control`}>
                {t("eventDetail.control")}
              </Button>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/criteria`}>
                {t("eventDetail.criteria")}
              </Button>
              <Button variant="outlined" component={RouterLink} to={`/events/${id}/awards`}>
                {t("eventDetail.awards")}
              </Button>
            </>
          )}
        </Stack>
      )}

      {/* 会場マッチング: 主催者はオファー確認、会場オーナーは提供オファー */}
      <VenueOfferPanel kind="for-event" id={id} enabled={isStaff} />
      {me && !isStaff && event.venueWanted && event.status === "published" && (
        <Box>
          <OfferVenueButton eventId={id} />
        </Box>
      )}

      {/* イベントフォト（参加者は常に、公開設定時は誰でも閲覧） */}
      <EventPhotos
        eventId={id}
        myRole={myRole}
        photosPublic={event.photosPublic}
        published={event.status === "published"}
      />

      {/* コメント（閲覧はイベントが見える人全員、投稿は参加確定者のみ） */}
      <EventComments eventId={id} myRole={myRole} canComment={canComment} />

      {contest && myEntry && <SubmissionEditor eventId={id} entry={myEntry} />}

      {contest &&
        (event.venueType === "online" || event.venueType === "hybrid") &&
        entries && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t("eventDetail.submissionsHeading")}
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
                                {t("eventDetail.submissionSlides")}
                              </Link>
                            )}
                            {e.submission?.sourceCodeUrl && (
                              <Link
                                href={e.submission.sourceCodeUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t("eventDetail.submissionCode")}
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
        {/* 画面に貼り付けたままにするので、中身が画面高を超えたら
            この列だけを縦スクロールさせる。そうしないと参加者一覧の下端に
            到達できなくなる（招待カードが加わって届かなくなりやすくなった） */}
        <Stack
          spacing={2}
          sx={{
            position: { md: "sticky" },
            top: { md: 16 },
            maxHeight: { md: "calc(100vh - 32px)" },
            overflowY: { md: "auto" },
          }}
        >
        {/* 運営を指名して招く (#339)。公開前でも一緒に準備できるようにする入口 */}
        {isStaff && <EventStaffInvitesCard eventId={id} />}
        {members && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t("eventDetail.participantsWithCount", { n: members.length })}
              </Typography>
              {event.attendanceCheck && (
                <Alert severity="info" sx={{ mb: 1, py: 0 }}>
                  {t(
                    isStaff
                      ? "eventDetail.attendanceModeNoticeStaff"
                      : "eventDetail.attendanceModeNotice",
                  )}
                </Alert>
              )}
              <List dense>
                {members?.map((m) => (
                  <MemberRow
                    key={m.id}
                    eventId={id}
                    member={m}
                    isStaff={isStaff}
                    attendanceCheck={event.attendanceCheck}
                    isMe={me?.id === m.user.id}
                  />
                ))}
              </List>
            </CardContent>
          </Card>
        )}
        </Stack>
      </Grid>
    </Grid>
  );
}

/** ロール変更が断られた理由を、その場で直せる形の文言にする (#281)。
 * 何が起きたか（なぜ変えられないか）と、次に何をすればよいかまで書く。
 * ここに挙げないコードは共通の辞書 (#352) がそのまま面倒を見る */
export function roleChangeErrorMessage(err: unknown): string {
  return errorMessage(err, {
    default: i18next.t("eventDetail.roleErrorDefault"),
    last_staff: i18next.t("eventDetail.roleErrorLastStaff"),
    event_ended: i18next.t("eventDetail.roleErrorEventEnded"),
    not_found: i18next.t("eventDetail.roleErrorNotFound"),
  });
}

/** 出席チェックが断られた理由 (#286)。UI では確定でない人のチェックを無効にして
 * いるが、一覧を開いたまま抽選が走るなどで通ってしまうことがあるので、その場合も
 * 無言で失敗させない */
export function attendanceErrorMessage(err: unknown): string {
  return errorMessage(err, {
    default: i18next.t("eventDetail.attendanceErrorDefault"),
    not_confirmed: i18next.t("eventDetail.attendanceErrorNotConfirmed"),
    not_found: i18next.t("eventDetail.attendanceErrorNotFound"),
  });
}

/** 参加者一覧の1行。staff にはロール変更メニューと出席チェックを出す */
export function MemberRow({
  eventId,
  member: m,
  isStaff,
  attendanceCheck,
  isMe,
}: {
  eventId: string;
  member: EventMemberWithUser;
  isStaff: boolean;
  attendanceCheck: boolean;
  isMe: boolean;
}) {
  const { t } = useTranslation();
  const setRole = useSetEventMemberRole(eventId);
  // 行ごとに持つ（ロール変更と同じ）。1つを全行で共有すると、続けて操作したとき
  // 後の行の結果が前の行のエラー表示を消してしまう (#286)
  const setAttendance = useSetAttendance(eventId);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [roleError, setRoleError] = useState("");
  const [attendError, setAttendError] = useState("");
  const showCheck = attendanceCheck && isStaff;
  const memberName = m.user.globalName ?? m.user.username;
  /** 出席にできるのは参加確定の人だけ (#286)。staff/judge/observer は
   * ロール変更時に確定になる (#277) ので、ここで弾かれるのは
   * 落選・抽選申込中・キャンセル待ちの人だけ。
   * 既に出席が付いている行は、確定でなくても解除できるようチェックを触れる状態にする */
  const isConfirmed = m.status === "confirmed";
  const canAttend = isConfirmed || m.attended;
  const status = statusLabel(m.status);
  const attendTitle = isConfirmed
    ? t("eventDetail.attendCheck")
    : m.attended
      ? t("eventDetail.attendUncheckOnly", { status })
      : t("eventDetail.attendNotConfirmed", { status });

  /** 一般参加者に戻すのは参加の取消 (#281)。申込が無言で消えるのを防ぐため、
   * この遷移だけ確認を挟む。他のロールへの変更は破壊的ではないので挟まない */
  const confirmRoleChange = (r: EventRole): boolean =>
    r !== "participant" ||
    window.confirm(t("eventDetail.demoteConfirm", { name: memberName }));
  const attendChip =
    attendanceCheck && m.attended ? (
      <Chip
        size="small"
        color="success"
        label={t("eventDetail.attendedChip")}
        sx={{ height: 18, fontSize: 10 }}
      />
    ) : null;

  return (
    <ListItem
      key={m.id}
      disableGutters
      secondaryAction={
        <Stack direction="row" spacing={0.5} alignItems="center">
          {showCheck ? (
            /* 押せない理由はその場で読めるようにする。無効なチェックボックスだけ
               置くと「押しても何も起きない」に見えるため (#286) */
            <Tooltip
              title={attendTitle}
              enterTouchDelay={0}
              leaveTouchDelay={5000}
            >
              {/* 無効なチェックボックスはフォーカスを受け取らないので、包む span を
                  フォーカス可能にする。そうしないとキーボードだけでは理由を読めない */}
              <span
                tabIndex={canAttend ? undefined : 0}
                aria-label={canAttend ? undefined : attendTitle}
              >
                <Checkbox
                  edge="end"
                  size="small"
                  icon={<CheckCircleOutlineIcon />}
                  checkedIcon={<CheckCircleIcon />}
                  checked={m.attended}
                  disabled={setAttendance.isPending || !canAttend}
                  onChange={(e) =>
                    setAttendance.mutate(
                      { userId: m.user.id, attended: e.target.checked },
                      { onError: (err) => setAttendError(attendanceErrorMessage(err)) },
                    )
                  }
                  inputProps={{ "aria-label": attendTitle }}
                />
              </span>
            </Tooltip>
          ) : (
            attendChip
          )}
          {/* 断られた理由は画面に出す（一覧を開いたまま状態が変わった場合） */}
          <Snackbar
            open={Boolean(attendError)}
            autoHideDuration={8000}
            onClose={() => setAttendError("")}
            message={attendError}
          />
          {/* 自分自身のロールは誤操作防止のため変更不可 */}
          {isStaff && !isMe && (
            <>
              <IconButton
                size="small"
                onClick={(e) => setAnchor(e.currentTarget)}
                title={t("eventDetail.changeRole")}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
              <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
                {EVENT_ROLES.map((r) => (
                  <MenuItem
                    key={r}
                    selected={m.role === r}
                    disabled={setRole.isPending}
                    onClick={() => {
                      setAnchor(null);
                      if (r === m.role || !confirmRoleChange(r)) return;
                      setRole.mutate(
                        { userId: m.user.id, role: r },
                        { onError: (e) => setRoleError(roleChangeErrorMessage(e)) },
                      );
                    }}
                  >
                    {roleLabel(r as EventRole)}
                    {m.role === r && (
                      <CheckIcon fontSize="small" sx={{ ml: 0.5 }} />
                    )}
                  </MenuItem>
                ))}
              </Menu>
              {/* 断られた理由は画面に出す。出さないと「押しても何も起きない」に見える */}
              <Snackbar
                open={Boolean(roleError)}
                autoHideDuration={8000}
                onClose={() => setRoleError("")}
                message={roleError}
              />
            </>
          )}
        </Stack>
      }
    >
      <ListItemButton
        component={RouterLink}
        to={`/users/${m.user.username}`}
        sx={{ borderRadius: 1 }}
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
          secondary={roleLabel(m.role)}
        />
      </ListItemButton>
    </ListItem>
  );
}
