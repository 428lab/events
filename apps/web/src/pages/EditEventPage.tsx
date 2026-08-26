import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import StadiumIcon from "@mui/icons-material/Stadium";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  QA_ANONYMITY_MODES,
  VENUE_TYPES,
  isDatetimeOrderInvalid,
  type MeetRankingMode,
  type QaAnonymity,
  type VenueType,
} from "@eventer/shared";
import {
  useDeleteEvent,
  useDuplicateEvent,
  useEvent,
  useIsAdmin,
  useUpdateEvent,
} from "../api/hooks.js";
import { useMyCommunities } from "../api/communityHooks.js";
import { generateEventImageBlob } from "../lib/imageTemplates.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { EventImageEditor } from "../components/EventImageEditor.js";
import { MeetPrizeEditor } from "../components/MeetPrizeEditor.js";
import { MarkdownEditor } from "../components/MarkdownEditor.js";
import { EventSlotsEditor } from "../components/EventSlotsEditor.js";
import { SurveyQuestionsEditor } from "../components/SurveyQuestionsEditor.js";
import { AwardsEditor } from "../components/AwardsEditor.js";
import { fromDateTimeLocal, venueLabel } from "../lib/format.js";
import { errorMessage } from "../lib/errorMessage.js";

/** 質問の名前の出し方 (`QaAnonymity`) → 翻訳キー。並びは QA_ANONYMITY_MODES が持つ */
const QA_ANONYMITY_KEY = {
  real: "eventForm.qaAnonymityReal",
  anon: "eventForm.qaAnonymityAnon",
  choice: "eventForm.qaAnonymityChoice",
} as const satisfies Record<QaAnonymity, string>;

function toLocalInput(epoch: number): string {
  // 日程調整中（未確定）は 0 が入っている。1970-01-01 を出さない
  if (!epoch) return "";
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditEventPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data, isLoading } = useEvent(id);
  const isAdmin = useIsAdmin();
  const update = useUpdateEvent(id);
  const del = useDeleteEvent(id);
  const duplicate = useDuplicateEvent(id);

  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [membersNote, setMembersNote] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  // 募集締切 (#269)。空文字＝締切なし（従来どおりイベント終了まで受け付ける）
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  // 日程調整中イベントで「調整をやめて直接日時を設定する」モード (#138)
  const [directDate, setDirectDate] = useState(false);
  const [venueType, setVenueType] = useState<VenueType>("offline");
  const [venueOffline, setVenueOffline] = useState("");
  const [venueOnline, setVenueOnline] = useState("");
  const [contestMode, setContestMode] = useState(false);
  const [attendanceCheck, setAttendanceCheck] = useState(false);
  // 部屋を開設するかはスタッフが決める (#221)。新規イベントは既定OFF
  const [chatEnabled, setChatEnabled] = useState(false);
  // 参加者のURL投稿を許可するか (#241)。既定OFF（スタッフは常に可）
  const [chatUrlsAllowed, setChatUrlsAllowed] = useState(false);
  // Q&A (#216)。チャットと同じく使いたいイベントだけONにする。既定OFF
  const [qaEnabled, setQaEnabled] = useState(false);
  const [qaAnonymity, setQaAnonymity] = useState<QaAnonymity>("choice");
  // 出会いランキング (#418)。既定OFF（名前が会場に大写しになりうる機能なので、
  // 出したいイベントだけが明示的にONにする）
  const [meetRanking, setMeetRanking] = useState<MeetRankingMode>("off");
  // 出会いの景品引き換え (#431)。既定OFF。景品の定義はオフでも仕込める
  const [meetPrizes, setMeetPrizes] = useState(false);
  const [venueWanted, setVenueWanted] = useState(false);
  const [communityId, setCommunityId] = useState("");
  const myCommunitiesQuery = useMyCommunities();
  const myCommunities = myCommunitiesQuery.data;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 複製後に /events/:newId/edit へ遷移してもコンポーネントは再マウントされないため、
  // id が変わったらフォームを新イベントの内容で初期化し直す
  useEffect(() => {
    setInitialized(false);
  }, [id]);

  useEffect(() => {
    if (data?.event && !initialized) {
      const e = data.event;
      setStatus(e.status === "published" ? "published" : "draft");
      setTitle(e.title);
      setSubtitle(e.subtitle);
      setDescription(e.description);
      setMembersNote(data.membersNote ?? "");
      setStartsAt(toLocalInput(e.startsAt));
      setEndsAt(toLocalInput(e.endsAt));
      setRegistrationDeadline(toLocalInput(e.registrationDeadline ?? 0));
      setVenueType(e.venueType);
      setVenueOffline(e.venueOffline ?? "");
      setVenueOnline(e.venueOnline ?? "");
      setContestMode(e.contestMode);
      setAttendanceCheck(e.attendanceCheck);
      setChatEnabled(e.chatEnabled);
      setChatUrlsAllowed(e.chatUrlsAllowed);
      setQaEnabled(e.qaEnabled);
      setQaAnonymity(e.qaAnonymity);
      setMeetRanking(e.meetRanking);
      setMeetPrizes(e.meetPrizes);
      setVenueWanted(e.venueWanted);
      setCommunityId(e.communityId ?? "");
      setInitialized(true);
    }
  }, [data, initialized]);

  if (isLoading || !data) return <Typography>{t("common.loading")}</Typography>;

  const isStaff = data.myRole === "staff" || isAdmin;
  if (!isStaff) {
    return <Alert severity="info">{t("eventForm.noPermission")}</Alert>;
  }
  const { event } = data;

  const deadlineMs = fromDateTimeLocal(registrationDeadline);
  const startsAtMs = fromDateTimeLocal(startsAt);
  const endsAtMs = fromDateTimeLocal(endsAt);
  // 募集締切 (#269) を設定できるのは開催日時が確定しているときだけ。
  // 日程調整中でも「日時を直接設定する」を選べば、この保存で確定するので入力可。
  // ただし開始・終了日時が実際に入っていることまで求める：空のまま締切だけ入れると
  // サーバーの deadline_requires_fixed_date / deadline_after_start で弾かれるので、
  // そもそも入力させない
  const deadlineEditable =
    (!event.scheduling || directDate) && startsAtMs !== null && endsAtMs !== null;
  // 終了が開始より前なら入力の時点で警告して保存させない (#399)。判定は共有の
  // isDatetimeOrderInvalid。日程調整をやめて直接確定する保存（scheduling: false
  // を送る）だけはサーバーが「終了 > 開始」を要求するので、同時刻も不可にする
  const dateOrderError =
    startsAtMs !== null &&
    endsAtMs !== null &&
    isDatetimeOrderInvalid(startsAtMs, endsAtMs, {
      requireDuration: event.scheduling && directDate,
    })
      ? t("eventForm.endBeforeStart")
      : "";
  // 開始後まで受け付けたい場合は「締切なし（空欄）」を選ぶ、という整理 (#269)
  const deadlineError =
    deadlineMs !== null && startsAtMs !== null && deadlineMs > startsAtMs
      ? t("eventForm.deadlineAfterStart")
      : "";
  // 保存失敗の理由。締切まわりは汎用文言だと何を直せばいいか分からないので、
  // この画面だけの言い方を overrides で渡す (#269)
  const saveErrorMessage = errorMessage(update.error, {
    default: t("eventForm.saveError"),
    deadline_requires_fixed_date: t("eventForm.deadlineNeedsDate"),
    deadline_after_start: t("eventForm.deadlineAfterStart"),
  });

  const save = () => {
    update.mutate(
      {
        status,
        title,
        subtitle,
        description,
        membersNote,
        // 日程調整中は日時未確定（0のまま）。入力があるときだけ送る
        ...(startsAtMs !== null && endsAtMs !== null
          ? { startsAt: startsAtMs, endsAt: endsAtMs }
          : {}),
        // 日程調整をやめて直接確定 (#138)
        ...(directDate && startsAtMs !== null && endsAtMs !== null
          ? { scheduling: false as const }
          : {}),
        // 募集締切 (#269)。空欄なら null を送って締切を解除する。
        // 入力できない状態のときはキー自体を送らない：null を送ってしまうと
        // 「開始日時を消しただけ」で既存の締切まで解除されてしまう
        ...(deadlineEditable ? { registrationDeadline: deadlineMs } : {}),
        venueType,
        venueOffline: venueOffline || null,
        venueOnline: venueOnline || null,
        contestMode,
        attendanceCheck,
        chatEnabled,
        chatUrlsAllowed,
        qaEnabled,
        qaAnonymity,
        meetRanking,
        meetPrizes,
        venueWanted,
        communityId: communityId || null,
      },
      { onSuccess: () => navigate(`/events/${id}`) },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          {t("eventForm.editTitle")}
        </Typography>
        <Stack spacing={2.5} sx={{ mt: 2 }}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("eventForm.statusHeading")}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={status}
              onChange={(_e, v) => v && setStatus(v)}
            >
              <ToggleButton value="draft">
                {t("eventForm.statusDraft")}
              </ToggleButton>
              <ToggleButton value="published">
                {t("eventForm.statusPublished")}
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {t("eventForm.statusHelp")}
            </Typography>
          </Box>
          <CounterTextField
            label={t("eventForm.title")}
            value={title}
            max={200}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />
          <CounterTextField
            label={t("eventForm.subtitle")}
            value={subtitle}
            max={200}
            onChange={(e) => setSubtitle(e.target.value)}
            fullWidth
          />
          <MarkdownEditor
            label={t("eventForm.description")}
            value={description}
            onChange={setDescription}
            minRows={3}
            max={20000}
            helperText={t("eventForm.markdownHelp")}
          />
          <MarkdownEditor
            label={t("eventForm.membersNote")}
            value={membersNote}
            onChange={setMembersNote}
            minRows={3}
            max={20000}
            helperText={t("eventForm.membersNoteHelp")}
          />
          {myCommunities && myCommunities.length > 0 && (
            <TextField
              select
              label={t("eventForm.community")}
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
              fullWidth
            >
              <MenuItem value="">{t("eventForm.communityNone")}</MenuItem>
              {myCommunities.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {event.scheduling && !directDate ? (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={() => setDirectDate(true)}>
                  {t("eventForm.setDateDirectly")}
                </Button>
              }
            >
              {t("eventForm.schedulingNotice")}
            </Alert>
          ) : (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label={t("eventForm.startsAt")}
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label={t("eventForm.endsAt")}
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                error={Boolean(dateOrderError)}
                helperText={dateOrderError || undefined}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Stack>
          )}
          {/* 募集締切 (#269)。開催日時が確定していないと設定できない */}
          <TextField
            label={t("eventForm.deadline")}
            type="datetime-local"
            value={deadlineEditable ? registrationDeadline : ""}
            onChange={(e) => setRegistrationDeadline(e.target.value)}
            disabled={!deadlineEditable}
            error={Boolean(deadlineError)}
            helperText={
              deadlineError ||
              t(
                deadlineEditable
                  ? "eventForm.deadlineHelp"
                  : "eventForm.deadlineDisabledHelp",
              )
            }
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            label={t("eventForm.venueType")}
            select
            value={venueType}
            onChange={(e) => setVenueType(e.target.value as VenueType)}
            fullWidth
          >
            {VENUE_TYPES.map((v) => (
              <MenuItem key={v} value={v}>
                {venueLabel(v)}
              </MenuItem>
            ))}
          </TextField>
          {venueType !== "online" && (
            <CounterTextField
              label={t("eventForm.venueOffline")}
              value={venueOffline}
              max={500}
              onChange={(e) => setVenueOffline(e.target.value)}
              fullWidth
            />
          )}
          {venueType !== "offline" && (
            <CounterTextField
              label={t("eventForm.venueOnline")}
              value={venueOnline}
              max={500}
              onChange={(e) => setVenueOnline(e.target.value)}
              fullWidth
            />
          )}

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={contestMode}
                  onChange={(e) => setContestMode(e.target.checked)}
                />
              }
              label={t("eventForm.contestMode")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.contestModeHelpEdit")}
            </Typography>
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={attendanceCheck}
                  onChange={(e) => setAttendanceCheck(e.target.checked)}
                />
              }
              label={t("eventForm.attendanceCheck")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.attendanceCheckHelp")}
            </Typography>
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={chatEnabled}
                  onChange={(e) => setChatEnabled(e.target.checked)}
                />
              }
              label={t("eventForm.chat")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.chatHelp")}
            </Typography>
            {chatEnabled && (
              <Box sx={{ pl: 3, mt: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={chatUrlsAllowed}
                      onChange={(e) => setChatUrlsAllowed(e.target.checked)}
                    />
                  }
                  label={t("eventForm.chatUrls")}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                >
                  {t("eventForm.chatUrlsHelp")}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Q&A (#216)。チャットの隣に置く（どちらも「使いたいイベントだけONにする」設定） */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={qaEnabled}
                  onChange={(e) => setQaEnabled(e.target.checked)}
                />
              }
              label={t("eventForm.qa")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.qaHelp")}
            </Typography>
            {qaEnabled && (
              <Box sx={{ pl: 3, mt: 1 }}>
                <TextField
                  select
                  size="small"
                  label={t("eventForm.qaAnonymity")}
                  value={qaAnonymity}
                  onChange={(e) => setQaAnonymity(e.target.value as QaAnonymity)}
                  sx={{ minWidth: 220 }}
                >
                  {QA_ANONYMITY_MODES.map((m) => (
                    <MenuItem key={m} value={m}>
                      {t(QA_ANONYMITY_KEY[m])}
                    </MenuItem>
                  ))}
                </TextField>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 1 }}
                >
                  {t("eventForm.qaAnonymityHelp")}
                </Typography>
              </Box>
            )}
          </Box>

          {/* 出会いランキング (#418)。オンにする行為が「盛り上げに使う」明示的な選択なので、
              オンの初期値は名前入り。オフに戻すと表示・取得の口ごと消える */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={meetRanking !== "off"}
                  onChange={(e) =>
                    setMeetRanking(e.target.checked ? "named" : "off")
                  }
                />
              }
              label={t("eventForm.meetRanking")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.meetRankingHelp")}
            </Typography>
            {meetRanking !== "off" && (
              <Box sx={{ pl: 3, mt: 1 }}>
                <TextField
                  select
                  size="small"
                  label={t("eventForm.meetRankingMode")}
                  value={meetRanking}
                  onChange={(e) =>
                    setMeetRanking(e.target.value as MeetRankingMode)
                  }
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value="named">{t("eventForm.meetRankingNamed")}</MenuItem>
                  <MenuItem value="anonymous">
                    {t("eventForm.meetRankingAnonymous")}
                  </MenuItem>
                </TextField>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 1 }}
                >
                  {meetRanking === "named"
                    ? t("eventForm.meetRankingNamedHelp")
                    : t("eventForm.meetRankingAnonymousHelp")}
                </Typography>
              </Box>
            )}
          </Box>

          {/* 出会いの景品引き換え (#431)。景品の定義（下の編集）は即保存され、
              オフのままでも仕込める。表示のオン/オフだけがこのフォームの保存対象 */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={meetPrizes}
                  onChange={(e) => setMeetPrizes(e.target.checked)}
                />
              }
              label={t("eventForm.meetPrizes")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.meetPrizesHelp")}
            </Typography>
            <MeetPrizeEditor eventId={id} />
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={venueWanted}
                  onChange={(e) => setVenueWanted(e.target.checked)}
                />
              }
              label={
                <Box
                  component="span"
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                >
                  <StadiumIcon fontSize="small" />
                  {t("eventForm.venueWanted")}
                </Box>
              }
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.venueWantedHelp")}
            </Typography>
          </Box>

          <Divider />
          <EventSlotsEditor eventId={id} />

          <Divider />
          <SurveyQuestionsEditor eventId={id} />

          {contestMode && (
            <>
              <Divider />
              <AwardsEditor eventId={id} />
            </>
          )}

          <Divider />
          <EventImageEditor event={event} />

          {update.isError && (
            <Alert severity="error">{saveErrorMessage}</Alert>
          )}
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} justifyContent="flex-end">
            <Button onClick={() => navigate(`/events/${id}`)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="contained"
              disabled={
                !title ||
                Boolean(dateOrderError) ||
                Boolean(deadlineError) ||
                update.isPending
              }
              onClick={save}
            >
              {t("common.save")}
            </Button>
          </Stack>

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("eventForm.duplicateHeading")}
            </Typography>
            <Button
              startIcon={<ContentCopyIcon />}
              disabled={duplicate.isPending}
              onClick={() => {
                if (
                  !window.confirm(t("eventForm.duplicateConfirm"))
                ) {
                  return;
                }
                duplicate.mutate(undefined, {
                  onSuccess: async ({ event: created }) => {
                    // 元イベントに画像が無い場合はコピーもされないため、
                    // 作成時と同様にタイトルから自動生成する (#139)
                    if (!created.imageUpdatedAt) {
                      const blob = await generateEventImageBlob(
                        created.title,
                        created.scheduling
                          ? t("eventForm.imageSchedulingSubtitle")
                          : undefined,
                      ).catch(() => null);
                      if (blob) {
                        await fetch(`/api/events/${created.id}/image`, {
                          method: "PUT",
                          headers: { "Content-Type": blob.type },
                          credentials: "include",
                          body: blob,
                        }).catch(() => undefined);
                      }
                    }
                    navigate(`/events/${created.id}/edit`);
                  },
                });
              }}
            >
              {t("eventForm.duplicateButton")}
            </Button>
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.duplicateHelp")}
            </Typography>
            {duplicate.isError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {t("eventForm.duplicateError")}
              </Alert>
            )}
          </Box>

          <Divider />
          <Box>
            <Typography variant="subtitle2" color="error" gutterBottom>
              {t("eventForm.dangerZone")}
            </Typography>
            {!confirmDelete ? (
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                {t("eventForm.deleteButton")}
              </Button>
            ) : (
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} alignItems="center">
                <Typography variant="body2">
                  {t("eventForm.deleteConfirm")}
                </Typography>
                <Button onClick={() => setConfirmDelete(false)}>
                  {t("eventForm.deleteAbort")}
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  disabled={del.isPending}
                  onClick={() =>
                    del.mutate(undefined, {
                      onSuccess: () => navigate("/"),
                    })
                  }
                >
                  {t("common.deleteSubmit")}
                </Button>
              </Stack>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
