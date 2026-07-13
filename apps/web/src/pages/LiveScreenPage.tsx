import { useEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, MenuItem, Paper, TextField, Typography } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import { useParams } from "react-router-dom";
import type { EventInfoField, LiveElement } from "@eventer/shared";
import { useEvent } from "../api/hooks.js";
import {
  useEventLiveDeck,
  useEventLiveSetContent,
  useEventLiveState,
} from "../api/liveControlHooks.js";
import { LiveSceneStage } from "../components/LiveStage.js";
import { SlideStage } from "../components/SlideStage.js";
import type { LiveRuntime } from "../components/LiveStage.js";
import { formatDateRange } from "../lib/format.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";

const DEVICE_KEY = "eventer-live-camera-device";

/** 配信画面タブ（OBSがウィンドウキャプチャする完成画面）。
 * AppBarなし・16:9レターボックス・1秒ポーリングでシーン切替 */
export function LiveScreenPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const event = eventData?.event;
  const { data: state } = useEventLiveState(id);
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

  // カメラ（全camera要素で1ストリームを共有）
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(
    () => localStorage.getItem(DEVICE_KEY) ?? "",
  );
  const needCamera = useMemo(
    () =>
      (liveSet?.content.scenes ?? []).some((s) =>
        s.elements.some((e) => e.type === "camera"),
      ),
    [liveSet],
  );
  useEffect(() => {
    if (!needCamera) return;
    let cancelled = false;
    let current: MediaStream | null = null;
    (async () => {
      try {
        current = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        if (cancelled) {
          current.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(current);
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setDevices(list.filter((d) => d.kind === "videoinput"));
        }
      } catch {
        if (!cancelled) setStream(null);
      }
    })();
    return () => {
      cancelled = true;
      current?.getTracks().forEach((t) => t.stop());
    };
  }, [needCamera, deviceId]);

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

  const deckSlide =
    deck?.content.slides[
      Math.min(state?.deckPage ?? 0, Math.max(0, (deck?.content.slides.length ?? 1) - 1))
    ] ?? null;

  const runtime: LiveRuntime = {
    camera: (el: LiveElement) => (
      <CameraVideo stream={stream} fit={el.fit ?? "cover"} />
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
            background: "#111827",
            color: "#64748b",
            fontSize: 18,
          }}
        >
          スライド未選択（コントロール画面で選べます）
        </div>
      ),
    eventInfo: (field: EventInfoField) => {
      if (!event) return "";
      switch (field) {
        case "title":
          return event.title;
        case "datetime":
          return event.scheduling
            ? "日程調整中"
            : formatDateRange(event.startsAt, event.endsAt);
        case "participants":
          return `参加 ${event.participantCount} 人`;
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
        // シーン切替時にフェードイン（key でリマウント）
        <Box
          key={scene.id}
          sx={{
            lineHeight: 0,
            animation: "liveFadeIn 400ms ease",
            "@keyframes liveFadeIn": {
              from: { opacity: 0 },
              to: { opacity: 1 },
            },
          }}
        >
          <LiveSceneStage scene={scene} width={stageW} runtime={runtime} />
        </Box>
      ) : (
        <Typography color="#334155">配信セットを読み込み中…</Typography>
      )}

      <audio ref={audioRef} hidden />

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
          🔇 クリックして BGM を有効化
        </Box>
      )}

      {/* 設定（キャプチャに写りにくいよう右下・カーソル表示中のみ） */}
      {cursorVisible && needCamera && (
        <Box sx={{ position: "fixed", right: 8, bottom: 8 }}>
          {settingsOpen && (
            <Paper sx={{ p: 1.5, mb: 1, width: 260 }}>
              <TextField
                select
                fullWidth
                size="small"
                label="カメラ"
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  localStorage.setItem(DEVICE_KEY, e.target.value);
                }}
              >
                <MenuItem value="">既定のカメラ</MenuItem>
                {devices.map((d) => (
                  <MenuItem key={d.deviceId} value={d.deviceId}>
                    {d.label || "カメラ"}
                  </MenuItem>
                ))}
              </TextField>
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

/** カメラ映像。共有ストリームを video に流し込む */
function CameraVideo({
  stream,
  fit,
}: {
  stream: MediaStream | null;
  fit: "cover" | "contain";
}) {
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
          background: "#111827",
          color: "#64748b",
          fontSize: 16,
        }}
      >
        カメラ待機中…
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
