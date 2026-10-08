import { useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { LiveScene, UpdateEventLiveStateInput } from "@eventer/shared";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import EditIcon from "@mui/icons-material/Edit";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DEFAULT_LIVE_SET_ID } from "@eventer/shared";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { Slider, IconButton, Tooltip } from "@mui/material";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import { useBgmTracks, useDeleteBgm, useUploadBgm } from "../api/bgmHooks.js";
import {
  useEventLiveDeck,
  useEventLiveSetContent,
  useEventLiveState,
  useLivePresenters,
  useUpdateEventLiveState,
} from "../api/liveControlHooks.js";
import { useMyLiveSets } from "../api/liveSetHooks.js";
import { useMyDecks } from "../api/deckHooks.js";
import { LiveSceneStage } from "../components/LiveStage.js";
import { LiveCameraMapCard } from "../components/LiveCameraMapPanel.js";
import { CameraSlotBadge } from "../components/LiveCameraSlotFields.js";
import { sceneCameraSlots } from "@eventer/shared";
import { useLiveEventChat } from "../components/LiveEventChat.js";
import { ManualLiveIndicatorControl } from "../components/ManualLiveIndicatorControl.js";
import { LiveCutinControl } from "../components/LiveCutinControl.js";
import {
  PresenterPanelToggle,
  PresenterSidePanel,
} from "../components/PresenterSidePanel.js";
import { LivePresenterSlides } from "../components/LivePresenterSlides.js";
import { usePresenterPanel } from "../lib/usePresenterPanel.js";

/** 配信コントロールタブ（シーン切替・配信セット選択）。スマホでも操作できる */
export function LiveControlPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const liveState = useEventLiveState(id);
  const { data: state } = liveState;
  const { data: liveSet } = useEventLiveSetContent(id, state?.liveSetId);
  const { data: mySets } = useMyLiveSets();
  const { data: myDecks } = useMyDecks();
  const { data: deck } = useEventLiveDeck(id, state?.deckId);
  const { data: presenters } = useLivePresenters(id);
  const { data: bgmTracks } = useBgmTracks();
  const uploadBgm = useUploadBgm();
  const deleteBgm = useDeleteBgm();
  const update = useUpdateEventLiveState(id);
  const bgmFileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [chatNow, setChatNow] = useState(() => Date.now());
  useLayoutEffect(() => { const timer = setInterval(() => setChatNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const liveChat = useLiveEventChat(id, state, liveState.current, chatNow, state?.chatSource === "event", "control");
  // 登壇者向けサイドパネル (#215)。開閉は発表ビューと共有する
  const [panelOpen] = usePresenterPanel();

  const selectedBgm = (bgmTracks ?? []).find(
    (track) => track.id === state?.bgmTrackId,
  );
  const onBgmFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const name = window.prompt(
      t("studio.bgmNamePrompt"),
      file.name.replace(/\.[^.]+$/, ""),
    );
    if (name === null) return;
    const credit = window.prompt(t("studio.bgmCreditPrompt"), "");
    try {
      await uploadBgm.mutateAsync({ file, name: name || file.name, credit: credit ?? "" });
    } catch {
      window.alert(t("studio.bgmUploadFailed"));
    }
  };
  const copyCredit = async () => {
    if (!selectedBgm?.creditText) return;
    await navigator.clipboard.writeText(selectedBgm.creditText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isStaff = eventData?.myRole === "staff" || isAdmin;
  if (eventData && !isStaff) {
    return <Alert severity="warning">{t("studio.controlStaffOnly")}</Alert>;
  }

  const scenes = liveSet?.content.scenes ?? [];
  const activeId =
    scenes.find((s) => s.id === state?.activeSceneId)?.id ?? scenes[0]?.id;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 3,
      }}
    >
      <Stack spacing={2.5} sx={{ flex: "1 1 320px", minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{
              flex: 1,
              minWidth: 200,
              display: "flex",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <LiveTvIcon fontSize="medium" />
            {t("studio.controlHeading")}
          </Typography>
          {/* 登壇者向けサイドパネル (#215)。開閉は発表ビューと共有する */}
          <PresenterPanelToggle />
          <Button
            variant="contained"
            startIcon={<OpenInNewIcon />}
            component={RouterLink}
            to={`/events/${id}/live/screen`}
            target="_blank"
          >
            {t("studio.openLiveScreen")}
          </Button>
        </Stack>

        <Alert severity="info" sx={{ py: 0.5 }}>
          {t("studio.obsHint", { action: t("studio.openLiveScreen") })}
        </Alert>

        {/* 手動の宣言。API は参加確定 staff のみ受け付ける（admin bypass なし）。 */}
        {eventData?.myRole === "staff" && <ManualLiveIndicatorControl state={state} fetchError={liveState.isError} pending={update.isPending} saveError={update.isError} onToggle={liveIndicatorOn => update.mutate({ liveIndicatorOn })} />}
        {eventData?.myRole === "staff" && <LiveCutinControl key={id} eventId={id} />}
        {eventData?.myRole === "staff" && <TextField select size="small" label={t("studio.chatSourceLabel")} value={state?.chatSource ?? "off"} disabled={!state || liveState.isError || update.isPending} onChange={e => update.mutate({ chatSource: e.target.value as "off" | "event" })} error={update.isError} helperText={update.isError ? t("studio.chatSaveFailed") : t(`studio.chatStatus${liveChat.status === "on" ? "On" : liveChat.status === "off" ? "Off" : liveChat.status === "connecting" ? "Connecting" : "Unavailable"}`)}><MenuItem value="off">{t("studio.chatOff")}</MenuItem><MenuItem value="event">{t("studio.chatSourceEvent")}</MenuItem></TextField>}
        {/* 配信セット選択 */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            select
            size="small"
            label={t("studio.liveSet")}
            value={state?.liveSetId ?? DEFAULT_LIVE_SET_ID}
            onChange={(e) =>
              update.mutate({
                liveSetId:
                  e.target.value === DEFAULT_LIVE_SET_ID ? null : e.target.value,
                activeSceneId: null,
              })
            }
            sx={{ minWidth: 220 }}
          >
            <MenuItem value={DEFAULT_LIVE_SET_ID}>
              {t("studio.liveSetDefault")}
            </MenuItem>
            {(mySets ?? []).map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name || t("studio.untitledLiveSet")}
              </MenuItem>
            ))}
          </TextField>
          {state?.liveSetId && state.liveSetId !== DEFAULT_LIVE_SET_ID && (
            <Button
              size="small"
              startIcon={<EditIcon />}
              component={RouterLink}
              to={`/live-sets/${state.liveSetId}/edit`}
            >
              {t("studio.editLiveSet")}
            </Button>
          )}
          <Button size="small" component={RouterLink} to="/live-sets">
            {t("studio.allLiveSets")}
          </Button>
        </Stack>

        {/* このPCのカメラの割り当て (#570)。セットにカメラが無ければ出さない */}
        {liveSet && (
          <LiveCameraMapCard
            key={liveSet.id}
            eventId={id}
            liveSetId={liveSet.id}
            liveSetName={liveSet.id === DEFAULT_LIVE_SET_ID ? t("studio.liveSetDefault") : liveSet.name || t("studio.untitledLiveSet")}
            content={liveSet.content}
          />
        )}

        {/* シーングリッド（タップで切替） */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, 1fr)",
              sm: "repeat(3, 1fr)",
              md: "repeat(4, 1fr)",
            },
            gap: 1.5,
          }}
        >
          {scenes.map((s) => {
            const active = s.id === activeId;
            return (
              <Box
                key={s.id}
                onClick={() => {
                  // シーンにBGM指定があれば一緒に切り替える（undefined=変更しない）
                  const patch: UpdateEventLiveStateInput = { activeSceneId: s.id };
                  if (s.bgmTrackId !== undefined) {
                    if (s.bgmTrackId === null) {
                      patch.bgmPlaying = false;
                    } else {
                      patch.bgmTrackId = s.bgmTrackId;
                      patch.bgmPlaying = true;
                    }
                  }
                  update.mutate(patch);
                }}
                sx={{
                  cursor: "pointer",
                  border: "3px solid",
                  borderColor: active ? "secondary.main" : "divider",
                  borderRadius: 1.5,
                  overflow: "hidden",
                  position: "relative",
                  lineHeight: 0,
                  "&:hover": { borderColor: active ? "secondary.main" : "primary.main" },
                }}
              >
                <ResponsiveScene sceneId={s.id} scene={s} />
                <Box
                  sx={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    px: 1,
                    py: 0.25,
                    bgcolor: "rgba(0,0,0,0.6)",
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  <Typography variant="caption" sx={{ color: "#fff", flex: 1 }} noWrap>
                    {s.name}
                  </Typography>
                  {sceneCameraSlots(s).map((slot) => <CameraSlotBadge key={slot} slot={slot} small />)}
                  {active && (
                    <Chip
                      size="small"
                      color="secondary"
                      label={t("studio.selectedScene")}
                      sx={{ height: 16, fontSize: 10, fontWeight: 700 }}
                    />
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>

        {scenes.length === 0 && (
          <Typography color="text.secondary">
            {t("studio.scenesEmpty", { action: t("studio.editLiveSet") })}
          </Typography>
        )}

        {/* 発表者とスライド (#571)。従来の自分のデッキ選択は「その他のスライド」として中にある */}
        <LivePresenterSlides
          state={state}
          presenters={presenters}
          deck={deck}
          myDecks={myDecks}
          onUpdate={(patch) => update.mutate(patch)}
        />

        {/* BGM */}
        <Stack spacing={1}>
          <Typography
            variant="h6"
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <MusicNoteIcon fontSize="small" />
            {t("studio.bgmHeading")}
          </Typography>
          <input
            ref={bgmFileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={onBgmFile}
          />
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label={t("studio.bgmTrack")}
              value={state?.bgmTrackId ?? ""}
              onChange={(e) =>
                update.mutate({
                  bgmTrackId: e.target.value || null,
                  bgmPlaying: false,
                })
              }
              sx={{ minWidth: 220 }}
              SelectProps={{ displayEmpty: true }}
            >
              <MenuItem value="">{t("studio.noneOption")}</MenuItem>
              {(bgmTracks ?? []).map((track) => (
                <MenuItem key={track.id} value={track.id}>
                  {track.ownerId === null ? (
                    <Box
                      component="span"
                      sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                    >
                      <CardGiftcardIcon fontSize="small" />
                      {track.name}
                    </Box>
                  ) : (
                    track.name
                  )}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant={state?.bgmPlaying ? "outlined" : "contained"}
              color={state?.bgmPlaying ? "error" : "primary"}
              startIcon={state?.bgmPlaying ? <StopIcon /> : <PlayArrowIcon />}
              disabled={!state?.bgmTrackId}
              onClick={() => update.mutate({ bgmPlaying: !state?.bgmPlaying })}
            >
              {state?.bgmPlaying ? t("studio.bgmStop") : t("studio.bgmPlay")}
            </Button>
            <Button
              size="small"
              startIcon={<UploadFileIcon />}
              disabled={uploadBgm.isPending}
              onClick={() => bgmFileRef.current?.click()}
            >
              {uploadBgm.isPending ? t("common.uploading") : t("studio.bgmAdd")}
            </Button>
            {selectedBgm && selectedBgm.ownerId !== null && (
              <Tooltip title={t("studio.bgmDelete")}>
                <IconButton
                  size="small"
                  onClick={() => {
                    if (
                      window.confirm(
                        t("studio.deleteConfirm", { name: selectedBgm.name }),
                      )
                    ) {
                      update.mutate({ bgmTrackId: null, bgmPlaying: false });
                      deleteBgm.mutate(selectedBgm.id);
                    }
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ maxWidth: 420 }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 40 }}>
              {t("studio.bgmVolume")}
            </Typography>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={state?.bgmVolume ?? 0.5}
              onChangeCommitted={(_e, v) => update.mutate({ bgmVolume: v as number })}
            />
          </Stack>
          {selectedBgm?.creditText && (
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ whiteSpace: "pre-wrap", flex: 1 }}
              >
                {selectedBgm.creditText}
              </Typography>
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyCredit}>
                {copied ? t("common.copied") : t("studio.bgmCopyCredit")}
              </Button>
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            {t("studio.bgmNote")}
          </Typography>
        </Stack>
      </Stack>
      {panelOpen && <PresenterSidePanel eventId={id} />}
    </Box>
  );
}

/** グリッド幅に追従するシーンサムネイル */
function ResponsiveScene({ scene }: { sceneId: string; scene: LiveScene }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", pointerEvents: "none" }}>
      {w > 0 && <LiveSceneStage scene={scene} width={w} />}
    </div>
  );
}
