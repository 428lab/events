import { Suspense, lazy } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import EggIcon from "@mui/icons-material/Egg";
import HourglassBottomIcon from "@mui/icons-material/HourglassBottom";
import LockIcon from "@mui/icons-material/Lock";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Markdown } from "../components/Markdown.js";
import { SchedulePanel } from "../components/SchedulePanel.js";
import { ShareButton } from "../components/ShareButton.js";
import { eventImageUrl, useEvent, useMe, usePublishEvent } from "../api/hooks.js";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";
import { useEventTiming } from "../lib/useEventTiming.js";
import { EventPhotos } from "../components/EventPhotos.js";
import { EventComments } from "../components/EventComments.js";
import { EventSchedule } from "../components/EventSchedule.js";
import { EventMaterials } from "../components/EventMaterials.js";
import { EventFeedback } from "../components/EventFeedback.js";
import { EventQa } from "../components/EventQa.js";
import { MeetRankingPanel } from "../components/MeetRanking.js";
import { MeetPrizePanel } from "../components/MeetPrizes.js";
import { BingoPanel } from "../components/BingoCard.js";
import { useRecordView } from "../api/analyticsHooks.js";
import { OfferVenueButton, VenueOfferPanel } from "../components/VenueOffers.js";
import { EventStaffInvitesCard } from "../components/EventStaffInvitesCard.js";
import { EventActionButtons } from "../components/EventActionButtons.js";
import { EventAwards } from "../components/EventAwards.js";
import { EventJoinPanel } from "../components/EventJoinPanel.js";
import { EventMemberList } from "../components/EventMemberList.js";
import { EventSubmissions } from "../components/EventSubmissions.js";
import {
  formatDateRange,
  formatDateTime,
  participantCountLabel,
  roleLabel,
  venueLabel,
} from "../lib/format.js";

/** Nostrチャット (#199)。nostr-tools（暗号ライブラリ）が大きいため遅延読み込みで分離する */
const EventChat = lazy(() =>
  import("../components/EventChat.js").then((m) => ({ default: m.EventChat })),
);

export function EventDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useEvent(id);
  // 参加確定メンバーか（コメント・チャット・Q&A の条件）と、チャットが実際に
  // 使えるか。同じ式を専用ページ側と2か所に持たないため hook に寄せてある (#215)
  const { canChat, chatAvailable } = useEventChatAccess(id);
  // 終了・締切の判定と1分ごとの時計。ページで1回だけ呼んで子に配る
  const timing = useEventTiming(data?.event);
  const publish = usePublishEvent();
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

  const isMember = Boolean(myRole);
  // アプリ管理者でも、このページでは自分のロールどおりに表示する
  // （他人のイベントでは一般参加者と同じ見え方にする）
  const isStaff = myRole === "staff";
  const contest = event.contestMode;
  const deadline = event.registrationDeadline;

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
              color: timing.registrationClosed
                ? "text.secondary"
                : timing.deadlineRemaining
                  ? (theme) =>
                      theme.palette.mode === "light"
                        ? theme.palette.warning.dark
                        : theme.palette.warning.main
                  : "text.secondary",
              fontWeight: timing.deadlineRemaining ? 700 : 400,
            }}
          >
            <HourglassBottomIcon fontSize="small" />
            {t("eventDetail.deadlineAt", { date: formatDateTime(deadline) })}
            {timing.registrationClosed
              ? t("eventDetail.deadlineClosedSuffix")
              : timing.deadlineRemaining
                ? t("eventDetail.deadlineRemainingSuffix", {
                    remaining: timing.deadlineRemaining,
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

      {/* 表彰の結果と、詳細な結果ページへの導線（出し分けはパネル側） */}
      <EventAwards eventId={id} contest={contest} ended={timing.ended} />

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
        canLike={canChat}
      />

      {/* 参加者チャット (#199)。確定メンバー＋公開＋日程確定のみ。本文はNostrリレー直通 */}
      {chatAvailable && (
        <Suspense fallback={null}>
          <EventChat
            eventId={id}
            event={event}
            myRole={myRole}
            canChat={canChat}
          />
        </Suspense>
      )}

      {/* Q&A (#216)。確定メンバーのみ。表示は QaQuestionList に切り出してあり
          投影用画面・プレゼンターのサイドパネル (#215) から再利用する */}
      {canChat && event.qaEnabled && (
        <EventQa eventId={id} canPost={canChat} />
      )}

      {/* 出会いランキング (#418)。設定がオンのイベントの確定メンバーのみ。
          この出し分けは利便のためで、防御はサーバー側の 404（存在ごと隠す）が担う */}
      {canChat && event.meetRanking !== "off" && (
        <MeetRankingPanel eventId={id} />
      )}

      {/* 出会いの景品 (#431)。設定がオンなら誰でも見える（参加の動機）。
          達成・交換済みの本人分はサーバーが確定メンバーにだけ添える */}
      {event.meetPrizes && <MeetPrizePanel eventId={id} />}

      {/* 数字ビンゴ (#436)。ゲームがあるイベントの確定メンバーにだけ出る
          （出し分けは利便。防御はサーバーの404） */}
      {canChat && <BingoPanel eventId={id} />}

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

      {/* 参加・取消と、そのまわり（入場QR・事前アンケート・参加枠） */}
      <EventJoinPanel
        eventId={id}
        event={event}
        myRole={myRole}
        contest={contest}
        timing={timing}
      />

      {/* イベント配下の各画面への導線（参加者本人にだけ出す） */}
      <EventActionButtons
        eventId={id}
        isMember={isMember}
        isStaff={isStaff}
        contest={contest}
        attendanceCheck={event.attendanceCheck}
      />

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
      <EventComments eventId={id} myRole={myRole} canComment={canChat} />

      {/* コンテストの提出物（自分のぶんの編集と、みんなの一覧） */}
      <EventSubmissions eventId={id} event={event} contest={contest} />
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
        <EventMemberList
          eventId={id}
          isStaff={isStaff}
          attendanceCheck={event.attendanceCheck}
        />
        </Stack>
      </Grid>
    </Grid>
  );
}
