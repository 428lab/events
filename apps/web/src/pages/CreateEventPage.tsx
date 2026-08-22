import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
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
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  EVENT_IMAGE,
  VENUE_TYPES,
  isDatetimeOrderInvalid,
  type VenueType,
} from "@eventer/shared";
import { useCreateEvent } from "../api/hooks.js";
import { useMyCommunities } from "../api/communityHooks.js";
import { useEventRequest, useLinkRequestEvent } from "../api/requestHooks.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { ImageCropField } from "../components/ImageCropField.js";
import { MarkdownEditor } from "../components/MarkdownEditor.js";
import { EventImageStudio } from "../components/EventImageStudio.js";
import { formatDateRange, venueLabel } from "../lib/format.js";
import { generateEventImageBlob } from "../lib/imageTemplates.js";

function toEpoch(local: string): number {
  return new Date(local).getTime();
}

export function CreateEventPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const createEvent = useCreateEvent();
  const { data: myCommunities } = useMyCommunities();
  // たまご（あったらいいな）からの開催宣言: ?fromRequest=<id> でプリフィル＋作成後リンク
  const [searchParams] = useSearchParams();
  const fromRequestId = searchParams.get("fromRequest") ?? "";
  const fromRequest = useEventRequest(fromRequestId);
  const linkRequest = useLinkRequestEvent();

  const [communityId, setCommunityId] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [venueType, setVenueType] = useState<VenueType>("offline");
  const [venueOffline, setVenueOffline] = useState("");
  const [venueOnline, setVenueOnline] = useState("");
  const [contestMode, setContestMode] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [venueWanted, setVenueWanted] = useState(false);
  const [scheduleAnonymous, setScheduleAnonymous] = useState(false);
  const [imageMode, setImageMode] = useState<"upload" | "template">("upload");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // イベント作成には成功したが、たまごへの紐付けに失敗したときの再試行用
  const [linkFailedEventId, setLinkFailedEventId] = useState<string | null>(null);

  // たまごの内容をプリフィル（1回だけ。日程は未定なので日程調整モードで開始）
  const prefilled = useRef(false);
  useEffect(() => {
    const req = fromRequest.data?.request;
    if (!req || prefilled.current) return;
    // コミュニティ付きたまごは、自分が運営するコミュニティの読み込みを待って照合する
    if (req.communityId && myCommunities == null) return;
    prefilled.current = true;
    // 既に入力があれば上書きしない
    setTitle((t) => t || req.title);
    setDescription((d) => d || req.description);
    if (req.venueTypePref) setVenueType(req.venueTypePref);
    // 自分が運営するコミュニティのときだけ引き継ぐ（権限のない紐付けを防ぐ）
    if (req.communityId && myCommunities?.some((cm) => cm.id === req.communityId)) {
      setCommunityId(req.communityId);
    }
    setScheduling(true);
  }, [fromRequest.data, myCommunities]);

  const setCropped = (blob: Blob) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageBlob(blob);
    setImagePreview(URL.createObjectURL(blob));
  };
  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageBlob(null);
    setImagePreview(null);
  };

  // 終了が開始より前なら入力の時点で警告して送信させない (#399)。
  // 順序の判定は共有の isDatetimeOrderInvalid（サーバーの守りと同じ契約）
  const dateOrderError =
    !scheduling &&
    Boolean(startsAt && endsAt) &&
    isDatetimeOrderInvalid(toEpoch(startsAt), toEpoch(endsAt));

  const canSubmit =
    title && (scheduling || (startsAt && endsAt)) && !dateOrderError;

  const submit = () => {
    createEvent.mutate(
      {
        title,
        subtitle,
        description,
        startsAt: scheduling ? 0 : toEpoch(startsAt),
        endsAt: scheduling ? 0 : toEpoch(endsAt),
        venueType,
        venueOffline: venueOffline || null,
        venueOnline: venueOnline || null,
        aggregateSelfEntry: false,
        contestMode,
        communityId: communityId || null,
        scheduling,
        scheduleAnonymous: scheduling ? scheduleAnonymous : false,
        venueWanted,
      },
      {
        onSuccess: async ({ event }) => {
          // 画像未設定ならタイトルから自動生成（失敗しても作成は続行）
          let uploadBlob = imageBlob;
          if (!uploadBlob) {
            uploadBlob = await generateEventImageBlob(
              title,
              scheduling ? t("eventForm.imageSchedulingSubtitle") : undefined,
            ).catch(() => null);
          }
          if (uploadBlob) {
            await fetch(`/api/events/${event.id}/image`, {
              method: "PUT",
              headers: { "Content-Type": uploadBlob.type },
              credentials: "include",
              body: uploadBlob,
            }).catch(() => undefined);
          }
          // たまごからの開催宣言なら紐付け（公開時に賛同者へ通知される）。
          // 失敗したら遷移せず、このページで再試行できるようにする
          if (fromRequestId) {
            try {
              await linkRequest.mutateAsync({
                requestId: fromRequestId,
                eventId: event.id,
              });
            } catch {
              setLinkFailedEventId(event.id);
              return;
            }
          }
          navigate(`/events/${event.id}`);
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          {t("eventForm.createTitle")}
        </Typography>
        <Stack spacing={2.5} sx={{ mt: 2 }}>
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
          {myCommunities && myCommunities.length > 0 && (
            <TextField
              select
              label={t("eventForm.community")}
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
              fullWidth
              helperText={t("eventForm.communityHelp")}
            >
              <MenuItem value="">{t("eventForm.communityNone")}</MenuItem>
              {myCommunities.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={scheduling}
                onChange={(e) => setScheduling(e.target.checked)}
              />
            }
            label={t("eventForm.scheduling")}
          />
          {scheduling && (
            <FormControlLabel
              sx={{ ml: 3 }}
              control={
                <Switch
                  checked={scheduleAnonymous}
                  onChange={(e) => setScheduleAnonymous(e.target.checked)}
                />
              }
              label={t("eventForm.scheduleAnonymous")}
            />
          )}
          {!scheduling && (
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
                error={dateOrderError}
                helperText={
                  dateOrderError ? t("eventForm.endBeforeStart") : undefined
                }
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Stack>
          )}
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
              {t("eventForm.contestModeHelpCreate")}
            </Typography>
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

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("eventForm.imageHeadingOptional", {
                width: EVENT_IMAGE.width,
                height: EVENT_IMAGE.height,
              })}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={imageMode}
              onChange={(_e, v) => v && setImageMode(v)}
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="upload">
                {t("eventForm.imageModeUpload")}
              </ToggleButton>
              <ToggleButton value="template">
                {t("eventForm.imageModeTemplate")}
              </ToggleButton>
            </ToggleButtonGroup>

            {imagePreview && (
              <Box
                component="img"
                src={imagePreview}
                alt="preview"
                sx={{
                  width: "100%",
                  maxWidth: 480,
                  aspectRatio: `${EVENT_IMAGE.width} / ${EVENT_IMAGE.height}`,
                  objectFit: "cover",
                  borderRadius: 1,
                  display: "block",
                  mb: 1,
                }}
              />
            )}

            {imageMode === "upload" ? (
              <Stack direction="row" spacing={1}>
                <ImageCropField
                  label={t(
                    imagePreview ? "eventForm.imageChange" : "eventForm.imageSelect",
                  )}
                  onCropped={setCropped}
                />
                {imagePreview && (
                  <Button color="error" onClick={clearImage}>
                    {t("eventForm.imageRemove")}
                  </Button>
                )}
              </Stack>
            ) : (
              <EventImageStudio
                title={title}
                subtitle={
                  startsAt
                    ? formatDateRange(
                        toEpoch(startsAt),
                        toEpoch(endsAt || startsAt),
                      )
                    : undefined
                }
                onGenerated={setCropped}
              />
            )}
          </Box>

          {createEvent.isError && (
            <Typography color="error" variant="body2">
              {t("eventForm.createError")}
            </Typography>
          )}
          {linkFailedEventId ? (
            <Stack spacing={1}>
              <Typography color="error" variant="body2">
                {t("eventForm.linkFailed")}
              </Typography>
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} justifyContent="flex-end">
                <Button onClick={() => navigate(`/events/${linkFailedEventId}`)}>
                  {t("eventForm.linkSkip")}
                </Button>
                <Button
                  variant="contained"
                  disabled={linkRequest.isPending}
                  onClick={async () => {
                    try {
                      await linkRequest.mutateAsync({
                        requestId: fromRequestId,
                        eventId: linkFailedEventId,
                      });
                      navigate(`/events/${linkFailedEventId}`);
                    } catch {
                      // 失敗表示のまま再試行可能
                    }
                  }}
                >
                  {t("eventForm.linkRetry")}
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} justifyContent="flex-end">
              <Button onClick={() => navigate(-1)}>{t("common.cancel")}</Button>
              <Button
                variant="contained"
                disabled={!canSubmit || createEvent.isPending}
                onClick={submit}
              >
                {t("eventForm.createSubmit")}
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
