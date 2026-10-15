import {EventVisibilityField} from "../components/EventVisibilityField.js";
import {api, ApiError} from "../api/client.js";
import type {Event} from "@eventer/shared";
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
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import {
  CHAT_CLOSE_AFTER_DEFAULT_MINUTES,
  CHAT_OPEN_BEFORE_DEFAULT_MINUTES,
  PUBLISH_AT_STEP_MS,
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
import { DescriptionImageTray } from "../components/DescriptionImageTray.js";
import { removeImageReferences } from "../lib/descriptionImages.js";
import { EventSlotsEditor } from "../components/EventSlotsEditor.js";
import { SurveyQuestionsEditor } from "../components/SurveyQuestionsEditor.js";
import { ChatWriteWindowField } from "../components/ChatWriteWindowField.js";
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

/** 予約公開の時刻の選択肢（00:00〜23:30 の30分刻み）。cron-hub が毎時0分・30分にだけ動くため。
 * datetime-local の step はスマホで効かないので、日付と時刻の select に分ける */
const PUBLISH_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

/** 今より後の、いちばん近い0分か30分 */
function nextPublishSlot(now = Date.now()): number {
  return Math.floor(now / PUBLISH_AT_STEP_MS) * PUBLISH_AT_STEP_MS + PUBLISH_AT_STEP_MS;
}

export function EditEventPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data, isLoading, refetch } = useEvent(id);
  const isAdmin = useIsAdmin();
  const update = useUpdateEvent(id);
  const del = useDeleteEvent(id);
  const duplicate = useDuplicateEvent(id);

  // 予約公開 (D-EVENT-SCHEDULED-PUBLISH)。"scheduled" は下書き＋公開日時
  const [status, setStatus] = useState<"draft" | "scheduled" | "published">("draft");
  const [publishAt, setPublishAt] = useState("");
  const [visibility,setVisibility]=useState<Event["visibility"]>("public");
  const [visibilityError,setVisibilityError]=useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [membersNote, setMembersNote] = useState("");
  /** 説明文画像を消したら、どちらの入力欄からも参照を外す（壊れた画像を残さない） */
  const removeDescriptionImage = (image: { url: string }) => {
    setDescription((v) => removeImageReferences(v, image.url));
    setMembersNote((v) => removeImageReferences(v, image.url));
  };
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  // 募集締切 (#269)。空文字＝締切なし（従来どおりイベント終了まで受け付ける）
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  // 日程調整中イベントで「調整をやめて直接日時を設定する」モード (#138)
  const [directDate, setDirectDate] = useState(false);
  const [venueType, setVenueType] = useState<VenueType>("offline");
  const [venueOffline, setVenueOffline] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [venueOnline, setVenueOnline] = useState("");
  const [contestMode, setContestMode] = useState(false);
  const [attendanceCheck, setAttendanceCheck] = useState(false);
  // 部屋を開設するかはスタッフが決める (#221)。新規イベントは既定OFF
  const [chatEnabled, setChatEnabled] = useState(false);
  // 参加者のみ（暗号化）(#582)。一度オンで保存すると戻せない（サーバーが 409）
  const [chatEncrypted, setChatEncrypted] = useState(false);
  // 参加者のURL投稿を許可するか (#241)。既定OFF（スタッフは常に可）
  const [chatUrlsAllowed, setChatUrlsAllowed] = useState(false);
  // 書き込める期間 (#578)。既定は従来の「開始30分前〜終了2時間後」
  const [chatWindow, setChatWindow] = useState<{
    openBeforeMinutes: number | null;
    closeAfterMinutes: number;
  }>({
    openBeforeMinutes: CHAT_OPEN_BEFORE_DEFAULT_MINUTES,
    closeAfterMinutes: CHAT_CLOSE_AFTER_DEFAULT_MINUTES,
  });
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
  const [formRevision, setFormRevision] = useState(0);
  // 読み込んだときの日時と締切（入力欄の文字列）。変えたときだけ送るための比較元。
  // 日時を送ると revision の照合が掛かり、参加登録などで revision が上がっただけでも
  // 409 schedule_changed になるので、触っていない日時は送らない
  const [loadedSchedule, setLoadedSchedule] = useState({ startsAt: "", endsAt: "", registrationDeadline: "" });
  const [initialized, setInitialized] = useState(false);

  /** revision で守られている項目（公開状態・予約・公開範囲・日時・締切）を、サーバーの値に揃える。
   * revision もここで揃えるので、ほかの人の変更を古い値で上書きしないよう、この組は必ず一緒に入れ直す */
  const applyRevisionedFields = (e: Event) => {
    setStatus(e.status === "published" ? "published" : e.publishAt ? "scheduled" : "draft");
    setPublishAt(toLocalInput(e.publishAt ?? 0));
    setVisibility(e.visibility);
    setFormRevision(e.accessRevision);
    setDirectDate(false);
    const loaded = {
      startsAt: e.scheduling ? "" : toLocalInput(e.startsAt),
      endsAt: e.scheduling ? "" : toLocalInput(e.endsAt),
      registrationDeadline: toLocalInput(e.registrationDeadline ?? 0),
    };
    setStartsAt(loaded.startsAt);
    setEndsAt(loaded.endsAt);
    setRegistrationDeadline(loaded.registrationDeadline);
    setLoadedSchedule(loaded);
  };

  /** 409 のあと。題名・説明などの入力は消さず、revision で守られている項目だけ最新に入れ直す。
   * 自動で再送はしない（日程の取り合いを防ぐ照合なので、最新を見てから保存し直してもらう） */
  const resyncAfterConflict = async () => {
    const { data: latest } = await refetch();
    if (latest?.event) applyRevisionedFields(latest.event);
  };

  // 複製後に /events/:newId/edit へ遷移してもコンポーネントは再マウントされないため、
  // id が変わったらフォームを新イベントの内容で初期化し直す
  useEffect(() => {
    setInitialized(false);
  }, [id]);

  useEffect(() => {
    if (data?.event && !initialized) {
      const e = data.event;
      applyRevisionedFields(e);
      setTitle(e.title);
      setSubtitle(e.subtitle);
      setDescription(e.description);
      setMembersNote(data.membersNote ?? "");
      setVenueType(e.venueType);
      setVenueOffline(e.venueOffline ?? "");
      setVenueAddress(e.venueAddress ?? "");
      setVenueOnline(e.venueOnline ?? "");
      setContestMode(e.contestMode);
      setAttendanceCheck(e.attendanceCheck);
      setChatEnabled(e.chatEnabled);
      setChatEncrypted(e.chatEncrypted);
      setChatUrlsAllowed(e.chatUrlsAllowed);
      setChatWindow({
        openBeforeMinutes: e.chatOpenBeforeMinutes,
        closeAfterMinutes: e.chatCloseAfterMinutes,
      });
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
  // 保存済みでオンなら戻せない（スイッチは無効表示）
  const chatEncryptedLocked = event.chatEncrypted;
  // 非公開・限定公開ではチャットをオンにすると暗号化も同時にオン（変更不可。設計 7.1）。
  // 保存済みの公開範囲も非公開のときに限る: 公開→非公開へ切り替える保存では、暗号化を
  // 明示的にオンにしない限り従来どおり平文チャットが止まる（設計 1.2。黙って暗号化しない）
  const nonpublicChat = visibility !== "public" && event.visibility !== "public";
  const chatEncryptedForced = nonpublicChat && chatEnabled;
  const effectiveChatEncrypted =
    chatEncryptedLocked || chatEncryptedForced || chatEncrypted;

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
  // 予約公開の日時。未来の時刻だけ（過去はサーバーも 400 publish_at_past）。
  // 読み込んだときから変えていない予約は、時刻を過ぎていても弾かない（保存の時点で自動公開済みなら 409）
  const publishAtMs = status === "scheduled" ? fromDateTimeLocal(publishAt) : null;
  const publishAtUnchanged = publishAtMs !== null && publishAtMs === event.publishAt;
  const publishAtError =
    status !== "scheduled"
      ? ""
      : publishAtMs === null
        ? t("eventForm.publishAtRequired")
        : !publishAtUnchanged && publishAtMs <= Date.now()
          ? t("eventForm.publishAtPast")
          : !publishAtUnchanged && publishAtMs % PUBLISH_AT_STEP_MS !== 0
            ? t("eventForm.publishAtUnaligned")
            : "";
  // 公開状態か予約を読み込み時から変える保存は、読み込んだ revision を付ける（設計 §5.5）
  const nextPublishAt = status === "scheduled" ? publishAtMs : null;
  const nextStatus = status === "published" ? "published" : "draft";
  const publishStateEdited = nextStatus !== event.status || nextPublishAt !== (event.publishAt ?? null);
  // 日時・締切は読み込んだときから変えたときだけ送る（日程調整をやめて直接確定するときは必ず送る）
  const sendDates =
    startsAtMs !== null &&
    endsAtMs !== null &&
    (directDate || startsAt !== loadedSchedule.startsAt || endsAt !== loadedSchedule.endsAt);
  const sendDeadline = deadlineEditable && registrationDeadline !== loadedSchedule.registrationDeadline;
  // 保存失敗の理由。締切まわりは汎用文言だと何を直せばいいか分からないので、
  // この画面だけの言い方を overrides で渡す (#269)
  const saveErrorMessage = errorMessage(update.error, {
    default: t("eventForm.saveError"),
    schedule_changed: t("schedule.changed"),
    publish_state_changed: t("eventForm.publishStateChanged"),
    publish_at_past: t("eventForm.publishAtPast"),
    publish_at_unaligned: t("eventForm.publishAtUnaligned"),
    deadline_requires_fixed_date: t("eventForm.deadlineNeedsDate"),
    deadline_after_start: t("eventForm.deadlineAfterStart"),
  });

  const save = async () => {
    let expectedAccessRevision:number|undefined;
    setVisibilityError(false);
    if (visibility !== event.visibility) {
      if (!window.confirm(t("eventAccess.visibilityWarning"))) return;
      try {
        const preview=await api.get<{accessRevision:number;members:number;voters:number}>(`/events/${id}/visibility-preview`);
        if (!window.confirm(t("eventAccess.visibilityMembers",preview))) return;
        if (preview.accessRevision !== formRevision) { setVisibilityError(true); await resyncAfterConflict(); return; }
        expectedAccessRevision=preview.accessRevision;
      } catch { setVisibilityError(true); return; }
    }
    update.mutate(
      {
        ...(sendDates || sendDeadline || publishStateEdited ? { expectedAccessRevision: formRevision } : {}),
        ...(expectedAccessRevision === undefined ? {} : {visibility,expectedAccessRevision,confirmVisibilityChange:true}),
        status: nextStatus,
        // 公開にするときは送らない（サーバーが予約を消す）。下書きなら null で予約なし
        ...(nextStatus === "draft" ? { publishAt: nextPublishAt } : {}),
        title,
        subtitle,
        description,
        membersNote,
        // 日程調整中は日時未確定（0のまま）。入力があり、読み込んだときから変えたときだけ送る
        ...(sendDates && startsAtMs !== null && endsAtMs !== null
          ? { startsAt: startsAtMs, endsAt: endsAtMs }
          : {}),
        // 日程調整をやめて直接確定 (#138)
        ...(directDate && sendDates ? { scheduling: false as const } : {}),
        // 募集締切 (#269)。空欄なら null を送って締切を解除する。
        // 入力できない状態のときと、読み込んだときから変えていないときはキー自体を送らない：
        // null を送ってしまうと「開始日時を消しただけ」で既存の締切まで解除されてしまう
        ...(sendDeadline ? { registrationDeadline: deadlineMs } : {}),
        venueType,
        venueOffline: venueOffline || null,
        venueAddress: venueAddress || null,
        venueOnline: venueOnline || null,
        contestMode,
        attendanceCheck,
        // 非公開・限定公開のチャットは参加者のみ（暗号化）だけ (#582 設計 1.2 / 5.2)。
        // チャットをオンにすると暗号化も同時にオンにして送る（片方だけはサーバーが 400）
        chatEnabled:(visibility === "public" || effectiveChatEncrypted) && chatEnabled,
        // オンのときだけ送る。オフは「変更しない」と同じ（オン→オフはサーバーが 409）
        ...(effectiveChatEncrypted ? { chatEncrypted: true as const } : {}),
        chatUrlsAllowed,
        chatOpenBeforeMinutes: chatWindow.openBeforeMinutes,
        chatCloseAfterMinutes: chatWindow.closeAfterMinutes,
        qaEnabled,
        qaAnonymity,
        meetRanking,
        meetPrizes,
        venueWanted,
        communityId: communityId || null,
      },
      { onSuccess: () => navigate(`/events/${id}`), onError: async error => {
        if (expectedAccessRevision !== undefined) setVisibilityError(true);
        if (error instanceof ApiError && error.status === 409) await resyncAfterConflict();
      } },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          {t("eventForm.editTitle")}
        </Typography>
        <Stack spacing={2.5} sx={{ mt: 2 }}>
          <EventVisibilityField value={visibility} onChange={setVisibility} locked={data.nonpublicEligible===false}/>
          {visibilityError && <Alert severity="warning">{t("eventAccess.visibilityConflict")}</Alert>}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("eventForm.statusHeading")}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={status}
              onChange={(_e, v) => {
                if (!v) return;
                setStatus(v);
                // 初めて予約にするときは、次の0分か30分を入れておく
                if (v === "scheduled" && !publishAt) setPublishAt(toLocalInput(nextPublishSlot()));
              }}
            >
              <ToggleButton value="draft">
                {t("eventForm.statusDraft")}
              </ToggleButton>
              <ToggleButton value="scheduled">
                {t("eventForm.statusScheduled")}
              </ToggleButton>
              <ToggleButton value="published">
                {visibility === "public" ? t("eventForm.statusPublished") : t("eventAccess.published")}
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {t("eventForm.statusHelp")}
            </Typography>
            {status === "scheduled" && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  {t("eventForm.publishAtLabel")}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <TextField
                    label={t("eventForm.publishAtDate")}
                    type="date"
                    value={publishAt.slice(0, 10)}
                    onChange={(e) => setPublishAt(e.target.value ? `${e.target.value}T${publishAt.slice(11) || "00:00"}` : "")}
                    error={Boolean(publishAtError) && publishAt !== ""}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 3 }}
                  />
                  <TextField
                    select
                    label={t("eventForm.publishAtTime")}
                    value={publishAt.slice(11)}
                    onChange={(e) => setPublishAt(`${publishAt.slice(0, 10)}T${e.target.value}`)}
                    disabled={publishAt === ""}
                    error={Boolean(publishAtError) && publishAt !== ""}
                    SelectProps={{ native: true }}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 2 }}
                  >
                    {/* 30分区切りより前に入れた予約は、そのまま表示できるよう選択肢に足す */}
                    {publishAt !== "" && !PUBLISH_TIME_OPTIONS.includes(publishAt.slice(11)) && (
                      <option value={publishAt.slice(11)}>{publishAt.slice(11)}</option>
                    )}
                    {PUBLISH_TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </TextField>
                </Stack>
                <Typography
                  variant="caption"
                  color={publishAt !== "" && publishAtError ? "error" : "text.secondary"}
                  display="block"
                  sx={{ mt: 0.5 }}
                >
                  {(publishAt !== "" && publishAtError) || t("eventForm.publishAtHelp")}
                </Typography>
              </Box>
            )}
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
            footer={(insert) => (
              <DescriptionImageTray
                eventId={id}
                onInsert={insert}
                onRemoved={removeDescriptionImage}
              />
            )}
          />
          <MarkdownEditor
            label={t("eventForm.membersNote")}
            value={membersNote}
            onChange={setMembersNote}
            minRows={3}
            max={20000}
            helperText={t("eventForm.membersNoteHelp")}
            footer={(insert) => (
              <DescriptionImageTray
                eventId={id}
                onInsert={insert}
                onRemoved={removeDescriptionImage}
              />
            )}
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
          {venueType !== "online" && (
            <CounterTextField
              label={t("eventForm.venueAddress")}
              value={venueAddress}
              max={500}
              onChange={(e) => setVenueAddress(e.target.value)}
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
                  onChange={(e) => {
                    // 非公開・限定公開でオンにすると参加者のみ（暗号化）も同時にオンになり、
                    // 戻せない。オンにする前に確認する（設計 7.1）
                    if (
                      e.target.checked &&
                      nonpublicChat &&
                      !chatEncryptedLocked &&
                      !window.confirm(t("eventForm.chatEncryptedConfirm"))
                    ) {
                      return;
                    }
                    setChatEnabled(e.target.checked);
                  }}
                />
              }
              label={t("eventForm.chat")}
            />
            <Typography variant="caption" color="text.secondary" display="block">
              {t("eventForm.chatHelp")}
            </Typography>
            {chatEnabled && (
              <Box sx={{ pl: 3, mt: 1 }}>
                {/* 参加者のみ（暗号化）(#582 設計 7.1)。一方向: オン済みは無効表示 */}
                <FormControlLabel
                  control={
                    <Switch
                      checked={effectiveChatEncrypted}
                      disabled={chatEncryptedLocked || chatEncryptedForced}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setChatEncrypted(false);
                          return;
                        }
                        if (window.confirm(t("eventForm.chatEncryptedConfirm"))) {
                          setChatEncrypted(true);
                        }
                      }}
                    />
                  }
                  label={t("eventForm.chatEncrypted")}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mb: 1 }}
                >
                  {chatEncryptedLocked
                    ? t("eventForm.chatEncryptedLocked")
                    : chatEncryptedForced
                      ? t("eventForm.chatEncryptedNonpublic")
                      : t("eventForm.chatEncryptedHelp")}
                </Typography>
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
                <ChatWriteWindowField
                  openBeforeMinutes={chatWindow.openBeforeMinutes}
                  closeAfterMinutes={chatWindow.closeAfterMinutes}
                  onChange={setChatWindow}
                />
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
              <Typography>{t("eventRun.awardsMoved")}</Typography>
              {event.contestMode ? (
                <Button component={RouterLink} to={`/events/${id}/control#awards`}>
                  {t("eventRun.setupAwards")}
                </Button>
              ) : <Typography>{t("eventRun.saveEventForAwards")}</Typography>}
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
                Boolean(publishAtError) ||
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
