import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Paper, Typography } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { liveCameraSlotOf, usedCameraSlots } from "@eventer/shared";
import type { EventInfoField, LiveCameraSlot, LiveElement } from "@eventer/shared";
import { cameraStatusChannelName, resolveCameraSlots } from "../lib/liveCameraMapping.js";
import type { CameraSlotState, CameraStatusMessage } from "../lib/liveCameraMapping.js";
import { useCameraMap, useCameraStreams, useVideoDevices } from "../lib/useLiveCameras.js";
import { LiveCameraMapRows, requestCameraPermission } from "../components/LiveCameraMapPanel.js";
import { useEvent } from "../api/hooks.js";
import {
  useEventLiveDeck,
  useEventLiveSetContent,
  useEventLiveState,
} from "../api/liveControlHooks.js";
import { LiveSceneStage } from "../components/LiveStage.js";
import { LiveCutinScreen } from "../components/LiveCutinScreen.js";
import { useLiveEventChat } from "../components/LiveEventChat.js";
import { SlideStage } from "../components/SlideStage.js";
import type { LiveRuntime } from "../components/LiveStage.js";
import { formatDateRange, participantCountLabel } from "../lib/format.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";
import { canShowLiveIndicator } from "../lib/liveIndicator.js";
import { clockText } from "../lib/liveTime.js";

/** 配信画面タブ（OBSがウィンドウキャプチャする完成画面）。
 * AppBarなし・16:9レターボックス・1秒ポーリングでシーン切替 */
export function LiveScreenPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const event = eventData?.event;
  const liveState = useEventLiveState(id, "screen");
  const { data: state } = liveState;
  const [wallNow, setWallNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setWallNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const { data: liveSet } = useEventLiveSetContent(id, state?.liveSetId);
  const { data: deck } = useEventLiveDeck(id, state?.deckId);

  // ウィンドウサイズに合わせて 16:9 を最大化
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const stageW = Math.min(size.w, (size.h * 16) / 9);

  // カメラ (#570)。番号を機器に解決し、異なる機器ごとに1本だけ開いて番号の間で共有する。
  // セットで使う機器は開いたままにして、シーンの切り替えで黒い枠を出さない
  const liveSetId = liveSet?.id;
  const slots = useMemo(() => (liveSet ? usedCameraSlots(liveSet.content) : []), [liveSet]);
  const needCamera = slots.length > 0;
  const [cameraMap, assignCamera] = useCameraMap(liveSetId);
  const streamsRetry = useRef<() => void>(() => {});
  const { devices, permitted, refresh: refreshDevices } = useVideoDevices(needCamera, () => streamsRetry.current());
  const resolved = useMemo(() => resolveCameraSlots(slots, cameraMap, devices), [slots, cameraMap, devices]);
  const streams = useCameraStreams([...resolved.values()].map(r => r.device), needCamera);
  streamsRetry.current = streams.retryFailed;
  const slotState = (slot: LiveCameraSlot): CameraSlotState => {
    const device = resolved.get(slot)?.device;
    return device === undefined ? "opening" : streams.get(device)?.state ?? "opening";
  };
  const streamFor = (slot: LiveCameraSlot) => {
    const device = resolved.get(slot)?.device;
    return device === undefined ? null : streams.get(device)?.stream ?? null;
  };
  // 開けたら機器名が読めるようになるので、一覧を読み直して名前での探し直しに使う
  const anyLive = slots.some(slot => slotState(slot) === "live");
  useEffect(() => { if (anyLive && !permitted) void refreshDevices(); }, [anyLive, permitted]);

  // 同じPCの配信コントロールへ、開いているかと番号ごとの様子を知らせる
  const statusRef = useRef<CameraStatusMessage | null>(null);
  statusRef.current = liveSetId && needCamera
    ? { type: "screen", liveSetId, slots: slots.map(slot => ({ slot, via: resolved.get(slot)?.via ?? "unmapped", state: slotState(slot) })) }
    : liveSetId ? { type: "screen", liveSetId, slots: [] } : null;
  const statusKey = JSON.stringify(statusRef.current);
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(cameraStatusChannelName(id));
    channelRef.current = ch;
    const send = () => { if (statusRef.current) ch.postMessage(statusRef.current); };
    ch.onmessage = (e: MessageEvent<CameraStatusMessage>) => {
      if (e.data?.type === "ping") send();
      if (e.data?.type === "retry") streamsRetry.current();
    };
    const timer = setInterval(send, 2000);
    const onUnload = () => ch.postMessage({ type: "screenClosed" } satisfies CameraStatusMessage);
    window.addEventListener("pagehide", onUnload);
    return () => { clearInterval(timer); window.removeEventListener("pagehide", onUnload); onUnload(); ch.close(); channelRef.current = null; };
  }, [id]);
  useEffect(() => { if (statusRef.current) channelRef.current?.postMessage(statusRef.current); }, [statusKey]);

  // 配信で映すデッキのフォントも読み込む
  useEffect(() => {
    if (deck) ensureDeckFonts(deck.content);
  }, [deck]);

  // フォント読み込み（デッキと同じWebフォント群）
  useEffect(() => {
    if (liveSet) {
      ensureDeckFonts({
        slides: liveSet.content.scenes.map((s) => ({
          id: s.id,
          background: "",
          elements: s.elements.map((e) => ({
            id: e.id,
            type: "text" as const,
            x: 0, y: 0, w: 0, h: 0, rotation: 0,
            fontFamily: e.fontFamily,
          })),
        })),
      });
    }
  }, [liveSet]);

  // BGM（配信画面側で再生。OBSのデスクトップ音声が拾う）
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state) return;
    audio.volume = state.bgmVolume;
    if (state.bgmTrackId && state.bgmPlaying) {
      const src = `/api/bgm/${state.bgmTrackId}/audio`;
      if (!audio.src.endsWith(src)) audio.src = src;
      audio.loop = true;
      audio
        .play()
        .then(() => setAudioBlocked(false))
        .catch(() => setAudioBlocked(true));
    } else {
      audio.pause();
      setAudioBlocked(false);
    }
  }, [state?.bgmTrackId, state?.bgmPlaying, state?.bgmVolume]);

  // カーソル自動非表示（3秒）
  const [cursorVisible, setCursorVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setCursorVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setCursorVisible(false), 3000);
  };
  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const scenes = liveSet?.content.scenes ?? [];
  const scene =
    scenes.find((s) => s.id === state?.activeSceneId) ?? scenes[0] ?? null;

  const lightScene = scene?.id.startsWith("v1-hakuji-") || scene?.background === "#F6F2EA";
  const hasChat = Boolean(scene?.elements.some(el => el.type === "chat"));
  const liveChat = useLiveEventChat(id, state, liveState.dataUpdatedAt, liveState.isError, wallNow, hasChat, "screen");

  const deckSlide =
    deck?.content.slides[
      Math.min(state?.deckPage ?? 0, Math.max(0, (deck?.content.slides.length ?? 1) - 1))
    ] ?? null;

  const runtime: LiveRuntime = {
    chatRows: liveChat.rows,
    // A failed or stale GET never authorizes an ON badge, even when React Query retains old data.
    liveIndicatorOn: canShowLiveIndicator(state, liveState.dataUpdatedAt, liveState.isError, event?.endsAt, wallNow),
    eventStartMs: event?.scheduling ? undefined : event?.startsAt,
    eventDatetimeAvailable: Boolean(event && !event.scheduling && Number.isFinite(event.startsAt)),
    camera: (el: LiveElement) => (
      <CameraVideo stream={streamFor(liveCameraSlotOf(el))} fit={el.fit ?? "cover"} light={Boolean(lightScene)} />
    ),
    deck: (el: LiveElement) =>
      deckSlide ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
          }}
        >
          <SlideStage
            slide={deckSlide}
            width={Math.min(el.w, (el.h * 16) / 9)}
          />
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
            background: lightScene ? "#DCE9DF" : "#111827",
            color: lightScene ? "#203146" : "#64748b",
            fontSize: 18,
          }}
        >
          {lightScene ? t("studio.hakujiDeckUnavailable") : t("studio.deckUnselected")}
        </div>
      ),
    eventInfo: (field: EventInfoField) => {
      if (!event) return "";
      switch (field) {
        case "title":
          return event.title;
        case "datetime":
          return event.scheduling
            ? t("studio.datetimeTbd")
            : formatDateRange(event.startsAt, event.endsAt);
        case "participants":
          return participantCountLabel(event);
        case "community":
          return eventData?.community?.name ?? "";
      }
    },
  };

  return (
    <Box
      onMouseMove={wake}
      sx={{
        position: "fixed",
        inset: 0,
        bgcolor: "#000",
        display: "grid",
        placeItems: "center",
        cursor: cursorVisible ? "default" : "none",
        zIndex: 2000,
      }}
    >
      {scene ? (
        <Box sx={{ position: "relative", width: stageW, height: stageW * 9 / 16, lineHeight: 0 }}>
          {/* Only the scene fades; an action remains independent of scene changes. */}
          <Box key={scene.id} sx={{ animation: "liveFadeIn 400ms ease", "@keyframes liveFadeIn": { from: { opacity: 0 }, to: { opacity: 1 } } }}>
            <LiveSceneStage scene={scene} width={stageW} runtime={runtime} />
          </Box>
          <LiveCutinScreen key={id} eventId={id} />
        </Box>
      ) : (
        <Typography color="#334155">{t("studio.liveSetLoading")}</Typography>
      )}

      <audio ref={audioRef} hidden />
      {hasChat && state?.chatSource === "event" && liveChat.status === "unavailable" && <Box sx={{ position: "fixed", bottom: 8, right: 8, bgcolor: "#7f1d1d", color: "white", p: 1 }}>{t("studio.chatUnavailable")}</Box>}
      {liveState.isError && <Box sx={{ position: "fixed", top: 8, right: 8, bgcolor: "#7f1d1d", color: "white", p: 1 }}>{t("studio.liveStateUnavailable")}</Box>}
      {scene?.elements.some(el => el.type === "clock" && clockText(wallNow, el.timezone ?? "Asia/Tokyo", true, false) === null) && <Box sx={{ position: "fixed", top: 8, left: 8, bgcolor: "#7f1d1d", color: "white", p: 1 }}>{t("studio.clockUnavailable")}</Box>}

      {/* 自動再生ブロック時: 一度クリックしてもらう（配信者だけが見る画面） */}
      {audioBlocked && (
        <Box
          onClick={() => {
            const a = audioRef.current;
            if (a) void a.play().then(() => setAudioBlocked(false)).catch(() => {});
          }}
          sx={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            bgcolor: "rgba(0,0,0,0.75)",
            color: "#fff",
            px: 2,
            py: 1,
            borderRadius: 2,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          <Box
            component="span"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
          >
            <VolumeOffIcon fontSize="small" />
            {t("studio.bgmUnblock")}
          </Box>
        </Box>
      )}

      {/* 設定（キャプチャに写りにくいよう右下・カーソル表示中のみ） */}
      {cursorVisible && needCamera && (
        <Box sx={{ position: "fixed", right: 8, bottom: 8 }}>
          {settingsOpen && liveSet && (
            <Paper sx={{ p: 1.5, mb: 1, width: 300, maxHeight: "80vh", overflow: "auto" }}>
              {/* 歯車を開いたときだけ出す運営者向けの割り当て (#570)。配信の画面そのものには警告を重ねない */}
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t("studio.cameraMapTitle")}</Typography>
              {!permitted && (
                <Button size="small" sx={{ mb: 1 }} onClick={() => void requestCameraPermission(refreshDevices)}>{t("studio.cameraMapAllow")}</Button>
              )}
              <LiveCameraMapRows
                compact
                content={liveSet.content}
                map={cameraMap}
                assign={assignCamera}
                devices={devices}
                slotStates={Object.fromEntries(slots.map(slot => [slot, slotState(slot)]))}
                onRetry={streams.retryFailed}
              />
            </Paper>
          )}
          <IconButton
            size="small"
            onClick={() => setSettingsOpen((o) => !o)}
            sx={{ opacity: 0.4, "&:hover": { opacity: 1 }, color: "#94a3b8" }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}

/** カメラ映像。番号に解決した機器のストリーム（同じ機器の枠どうしで共有）を video に流し込む。
 * 開けない・止まった機器の枠は「カメラ待機中…」にする */
function CameraVideo({
  stream,
  fit,
  light = false,
}: {
  stream: MediaStream | null;
  fit: "cover" | "contain";
  light?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => {});
    }
  }, [stream]);
  if (!stream) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: light ? "#DCE9DF" : "#111827",
          color: light ? "#203146" : "#64748b",
          fontSize: 16,
        }}
      >
        {light ? t("studio.hakujiCameraUnavailable") : t("studio.cameraWaiting")}
      </div>
    );
  }
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}
    />
  );
}
