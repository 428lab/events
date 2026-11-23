import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import SensorsIcon from "@mui/icons-material/Sensors";
import { useTranslation } from "react-i18next";
import { messageKey, type MessageKey } from "../lib/messageKey.js";
import {
  DEFAULT_RTMP_URL,
  RELAY_README_URL,
  RELAY_RELEASES_URL,
  RelayError,
  captureLiveTab,
  findRelay,
  forgetRelayToken,
  loadRelayToken,
  pairRelay,
  readSenderStats,
  relayStatus,
  startRelayStream,
  type FoundRelay,
  type RelaySession,
  type RelayStatus,
  type SenderStats,
  type StreamPreset,
} from "../lib/liveRelay.js";

/** 配信中に送っている映像の統計と中継アプリの様子を読み直す間隔。手元の通信だけで、サーバーには問い合わせない */
const STATS_EVERY_MS = 5000;

type Phase = "searching" | "notFound" | "unpaired" | "ready" | "starting" | "live";

/**
 * 配信画面（`/live/screen`）の右上に出す小さな配信のバー (#11)。
 * 手元の中継アプリ（428lab/eventslab-relay）を探してつなぎ、このタブを取り込んで YouTube に送る。
 * **配信キーは React の state にだけ持つ。** events lab のサーバーにも localStorage にも送らない。
 */
export function LiveRelayBar({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("searching");
  const [relay, setRelay] = useState<FoundRelay | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [rtmpUrl, setRtmpUrl] = useState(DEFAULT_RTMP_URL);
  const [streamKey, setStreamKey] = useState("");
  const [preset, setPreset] = useState<StreamPreset>("720p");
  const [withMic, setWithMic] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [stats, setStats] = useState<SenderStats | null>(null);
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const session = useRef<{ relay: RelaySession; release: () => void; mic: MediaStreamTrack | null } | null>(null);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ビットレートを前回との差で出すための、前回の送信量と時刻 */
  const statsMark = useRef<{ bytes: number; at: number } | null>(null);
  const supported = typeof RTCPeerConnection !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);

  const search = useCallback(async () => {
    setPhase("searching");
    setError(null);
    const found = await findRelay();
    setRelay(found);
    if (!found) {
      setPhase("notFound");
      return;
    }
    const saved = loadRelayToken(found.base);
    setToken(saved);
    setPhase(saved ? "ready" : "unpaired");
  }, []);

  // 開いたときに1回だけ探す（定期には探さない）
  useEffect(() => {
    if (supported) void search();
  }, [search, supported]);

  const explain = (e: unknown): MessageKey => {
    if (e instanceof RelayError) {
      if (e.kind === "wrong_code") return messageKey("studio.relayWrongCode");
      if (e.kind === "too_many") return messageKey("studio.relayTooMany", { n: e.retryAfterSeconds ?? 30 });
      if (e.kind === "unauthorized") return messageKey("studio.relayUnauthorized");
      return messageKey("studio.relayRejected");
    }
    return messageKey("studio.relayUnreachable");
  };

  const pair = async () => {
    if (!relay) return;
    setError(null);
    try {
      setToken(await pairRelay(relay.base, code));
      setCode("");
      setPhase("ready");
    } catch (e) {
      setError(explain(e));
    }
  };

  const unpair = () => {
    if (relay) forgetRelayToken(relay.base);
    setToken(null);
    setPhase("unpaired");
  };

  const stopStatsLoop = () => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
    statsTimer.current = null;
  };

  const stop = useCallback(async (why?: MessageKey) => {
    stopStatsLoop();
    const s = session.current;
    session.current = null;
    s?.release();
    await s?.relay.stop();
    setStats(null);
    setStatus(null);
    setPhase((p) => (p === "live" || p === "starting" ? "ready" : p));
    if (why) setNotice(why);
  }, []);

  // ページを離れたら止める
  useEffect(() => () => void stop(), [stop]);

  const refresh = async () => {
    const s = session.current;
    if (!s || !relay || !token) return;
    const { stats: next, mark } = await readSenderStats(s.relay.pc, statsMark.current).catch(() => ({ stats: null, mark: statsMark.current }));
    statsMark.current = mark;
    if (next) setStats(next);
    try {
      setStatus(await relayStatus(relay.base, token));
    } catch (e) {
      if (e instanceof RelayError && e.kind === "unauthorized") {
        setError(explain(e));
        void stop();
      }
    }
  };

  // 配信中だけ、5秒ごとに手元の統計を読み直す（setTimeout の連鎖。止めたら止まる）
  const runStatsLoop = () => {
    statsTimer.current = setTimeout(async () => {
      if (!session.current) return;
      await refresh();
      if (session.current) runStatsLoop();
    }, STATS_EVERY_MS);
  };

  const start = async () => {
    if (!relay || !token || !streamKey.trim()) return;
    setError(null);
    setNotice(null);
    setPhase("starting");
    let capture: Awaited<ReturnType<typeof captureLiveTab>>;
    try {
      capture = await captureLiveTab(preset, withMic);
    } catch {
      setPhase("ready");
      setError(messageKey("studio.relayCaptureFailed"));
      return;
    }
    try {
      const relaySession = await startRelayStream(relay.base, token, capture.stream, { rtmpUrl: rtmpUrl.trim(), streamKey: streamKey.trim() }, preset);
      session.current = { relay: relaySession, release: capture.release, mic: capture.mic };
      if (capture.mic) capture.mic.enabled = micOn;
      // ブラウザの「共有を停止」で止める（設計 §10）
      capture.videoTrack.addEventListener("ended", () => void stop(messageKey("studio.relayShareCancelled")));
      relaySession.pc.addEventListener("connectionstatechange", () => {
        if (relaySession.pc.connectionState === "failed") void stop(messageKey("studio.relayUnreachable"));
        else void refresh();
      });
      statsMark.current = null;
      setPhase("live");
      // 配信の画に重ならないよう、始めたらパネルを閉じる（バーはカーソルを動かすと出る）
      setOpen(false);
      await refresh();
      runStatsLoop();
    } catch (e) {
      capture.release();
      setPhase("ready");
      setError(explain(e));
      if (e instanceof RelayError && e.kind === "unauthorized") {
        setToken(null);
        setPhase("unpaired");
      }
    }
  };

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    if (session.current?.mic) session.current.mic.enabled = next;
  };

  // カーソルを止めると隠れる（配信の画に写らないように）。開いているパネルは閉じるまで出す
  if (!visible && !open) return null;

  const live = phase === "live";
  const rtmpLine = status
    ? status.state === "error" && !status.ffmpeg
      ? { severity: "error" as const, text: t("studio.relayNoFfmpeg") }
      : status.rtmp === "ok"
        ? { severity: "success" as const, text: t("studio.relayRtmpOk") }
        : status.rtmp === "retrying"
          ? { severity: "warning" as const, text: t("studio.relayRtmpRetrying", { error: status.error ?? "" }) }
          : status.rtmp === "failed"
            ? { severity: "error" as const, text: t("studio.relayRtmpFailed", { error: status.error ?? "" }) }
            : null
    : null;

  // 左下に置く（右上は配信状態のエラー、右下はカメラの設定、上の中央は BGM の案内が使う）
  return (
    <Box sx={{ position: "fixed", left: 8, bottom: 8, zIndex: 2100, maxWidth: 380 }}>
      {!open ? (
        <Chip
          icon={<SensorsIcon />}
          color={live ? "error" : "default"}
          label={live ? t("studio.relayLive") : t("studio.relayBar")}
          onClick={() => setOpen(true)}
          aria-label={t("studio.relayOpen")}
          sx={{ opacity: live ? 0.9 : 0.6, "&:hover": { opacity: 1 } }}
        />
      ) : (
        <Paper sx={{ p: 1.5, maxHeight: "90vh", overflow: "auto" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">{live ? t("studio.relayLive") : t("studio.relayBar")}</Typography>
            <IconButton size="small" onClick={() => setOpen(false)} aria-label={t("studio.relayClose")}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          {!supported && <Alert severity="warning">{t("studio.relayChromeOnly")}</Alert>}

          {supported && phase === "searching" && <Typography variant="body2">{t("studio.relaySearching")}</Typography>}

          {supported && phase === "notFound" && (
            <Stack spacing={1}>
              <Alert severity="info">{t("studio.relayNotFound")}</Alert>
              <Typography variant="caption" color="text.secondary">{t("studio.relayLocalAccessHint")}</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button size="small" variant="outlined" onClick={() => void search()}>{t("studio.relaySearchAgain")}</Button>
                <Button size="small" component={Link} href={RELAY_RELEASES_URL} target="_blank" rel="noopener noreferrer">{t("studio.relayDownload")}</Button>
                <Button size="small" component={Link} href={RELAY_README_URL} target="_blank" rel="noopener noreferrer">{t("studio.relayHowTo")}</Button>
              </Stack>
            </Stack>
          )}

          {supported && relay && phase !== "notFound" && phase !== "searching" && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              {t("studio.relayFound", { version: relay.hello.version, port: new URL(relay.base).port })}
            </Typography>
          )}

          {supported && phase === "unpaired" && (
            <Stack spacing={1}>
              <Typography variant="body2" fontWeight={600}>{t("studio.relayPairTitle")}</Typography>
              <Typography variant="body2">{t("studio.relayPairHelp")}</Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label={t("studio.relayPairCode")}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputProps={{ inputMode: "numeric", autoComplete: "off" }}
                />
                <Button variant="contained" disabled={code.length !== 6} onClick={() => void pair()}>{t("studio.relayPair")}</Button>
              </Stack>
            </Stack>
          )}

          {supported && (phase === "ready" || phase === "starting") && (
            <Stack spacing={1.25}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Chip size="small" color="success" label={t("studio.relayPaired")} />
                <Button size="small" onClick={unpair}>{t("studio.relayUnpair")}</Button>
              </Stack>
              <TextField size="small" label={t("studio.relayRtmpUrl")} value={rtmpUrl} onChange={(e) => setRtmpUrl(e.target.value)} />
              <TextField
                size="small"
                type="password"
                label={t("studio.relayStreamKey")}
                value={streamKey}
                onChange={(e) => setStreamKey(e.target.value)}
                helperText={t("studio.relayStreamKeyHelp")}
                inputProps={{ autoComplete: "off" }}
              />
              <TextField select size="small" label={t("studio.relayPreset")} value={preset} onChange={(e) => setPreset(e.target.value as StreamPreset)}>
                <MenuItem value="720p">{t("studio.relayPreset720p")}</MenuItem>
                <MenuItem value="1080p">{t("studio.relayPreset1080p")}</MenuItem>
              </TextField>
              <FormControlLabel control={<Checkbox size="small" checked={withMic} onChange={(e) => setWithMic(e.target.checked)} />} label={t("studio.relayMic")} />
              <Typography variant="caption" color="text.secondary">{t("studio.relayShareHint")}</Typography>
              <Button variant="contained" color="error" disabled={phase === "starting" || !streamKey.trim() || !rtmpUrl.trim()} onClick={() => void start()}>
                {phase === "starting" ? t("studio.relayStarting") : t("studio.relayStart")}
              </Button>
            </Stack>
          )}

          {live && (
            <Stack spacing={1}>
              <Typography variant="body2">
                {stats?.kbps !== undefined
                  ? t("studio.relayStats", { kbps: stats.kbps, fps: stats.fps ?? 0, size: stats.width ? `${stats.width}×${stats.height}` : "—" })
                  : t("studio.relayStatsWaiting")}
              </Typography>
              {stats && (
                <Alert severity={stats.encoder === "software" ? "warning" : stats.encoder === "hardware" ? "success" : "info"} sx={{ py: 0 }}>
                  {stats.encoder === "hardware"
                    ? t("studio.relayEncoderHardware", { impl: stats.encoderImplementation ?? "" })
                    : stats.encoder === "software"
                      ? t("studio.relayEncoderSoftware", { impl: stats.encoderImplementation ?? "" })
                      : t("studio.relayEncoderUnknown")}
                </Alert>
              )}
              {rtmpLine && <Alert severity={rtmpLine.severity} sx={{ py: 0 }}>{rtmpLine.text}</Alert>}
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {session.current?.mic && (
                  <Button size="small" startIcon={micOn ? <MicIcon /> : <MicOffIcon />} onClick={toggleMic}>
                    {micOn ? t("studio.relayMicMute") : t("studio.relayMicUnmute")}
                  </Button>
                )}
                <Button size="small" onClick={() => void refresh()}>{t("studio.relayRefresh")}</Button>
                <Button size="small" variant="contained" color="inherit" onClick={() => void stop()}>{t("studio.relayStop")}</Button>
              </Stack>
            </Stack>
          )}

          {error && <Alert severity="error" sx={{ mt: 1 }}>{t(error.key, error.params)}</Alert>}
          {notice && <Alert severity="info" sx={{ mt: 1 }} onClose={() => setNotice(null)}>{t(notice.key, notice.params)}</Alert>}
        </Paper>
      )}
    </Box>
  );
}
