import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Box, Button, Chip, Collapse, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { usedCameraSlots } from "@eventer/shared";
import type { LiveCameraSlot, LiveSetContent } from "@eventer/shared";
import {
  DEFAULT_CAMERA_DEVICE,
  cameraLabels,
  cameraStatusChannelName,
  resolveCameraDevice,
} from "../lib/liveCameraMapping.js";
import type { CameraSlotState, CameraStatusMessage, LiveCameraMap, LiveCameraMapEntry } from "../lib/liveCameraMapping.js";
import { PREVIEW_CAMERA_VIDEO } from "../lib/liveCameraStreams.js";
import type { CameraStreamEntry } from "../lib/liveCameraStreams.js";
import { useCameraMap, useCameraStreams, useVideoDevices } from "../lib/useLiveCameras.js";
import { CameraSlotBadge } from "./LiveCameraSlotFields.js";

/** 配信画面からの知らせがこれより古ければ「見つかりません」にする */
const SCREEN_STALE_MS = 5000;

/** 番号ごとの「どの機器を使うか」の行と警告 (#570)。配信コントロールと配信画面の歯車で共有する */
export function LiveCameraMapRows({
  content,
  map,
  assign,
  devices,
  slotStates,
  onRetry,
  preview,
  compact = false,
}: {
  content: LiveSetContent;
  map: LiveCameraMap;
  assign: (slot: LiveCameraSlot, entry: LiveCameraMapEntry | null) => void;
  devices: MediaDeviceInfo[];
  /** 配信画面で開けたか。分からなければ undefined */
  slotStates?: Partial<Record<LiveCameraSlot, CameraSlotState>>;
  onRetry?: () => void;
  /** 小さな見本に流す映像。無ければ見本を出さない */
  preview?: (device: string) => CameraStreamEntry | undefined;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const slots = usedCameraSlots(content);
  const labels = cameraLabels(content);
  const slotName = (slot: LiveCameraSlot) => t("studio.cameraSlotName", { n: slot });
  const deviceName = (d: MediaDeviceInfo, i: number) => d.label || t("studio.cameraMapUnnamedDevice", { n: i + 1 });
  const unmapped = slots.filter(slot => !map[slot]);
  return (
    <Stack spacing={compact ? 1 : 1.5}>
      {slots.map(slot => {
        const entry = map[slot];
        const resolved = resolveCameraDevice(entry, devices);
        const selectable = entry && devices.some(d => d.deviceId === entry.deviceId) ? entry.deviceId : resolved.via === "label" ? resolved.device : "";
        const state = slotStates?.[slot];
        const scenesUsing = content.scenes.filter(s => s.elements.some(el => el.type === "camera" && (el.cameraSlot ?? 1) === slot)).map(s => s.name);
        return (
          <Box key={slot} data-testid={`camera-map-row-${slot}`} sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1.5, py: compact ? 0 : 1, borderTop: compact ? 0 : 1, borderColor: "divider" }}>
            <Box sx={{ minWidth: compact ? 0 : 140, flex: compact ? "1 1 100%" : "0 1 180px" }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <CameraSlotBadge slot={slot} />
                <Typography variant="body2" fontWeight={700}>{slotName(slot)}</Typography>
                {compact && labels[slot] && <Typography variant="caption" color="text.secondary" noWrap>{labels[slot]}</Typography>}
              </Stack>
              {!compact && (
                <Typography variant="caption" color="text.secondary" component="div">
                  {labels[slot] || t("studio.cameraMapNoLabel")} · {t("studio.cameraMapUsedIn", { scenes: scenesUsing.join("・") })}
                </Typography>
              )}
            </Box>
            <Box sx={{ flex: "1 1 200px", minWidth: 0 }}>
              <TextField
                select
                fullWidth
                size="small"
                label={t("studio.cameraMapDeviceFor", { name: slotName(slot) })}
                value={selectable}
                onChange={e => {
                  const id = e.target.value;
                  const device = devices.find(d => d.deviceId === id);
                  assign(slot, id && device ? { deviceId: id, label: device.label } : null);
                }}
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
              >
                <MenuItem value="">{t("studio.cameraMapUnassigned")}</MenuItem>
                {devices.filter(d => d.deviceId).map((d, i) => <MenuItem key={d.deviceId} value={d.deviceId}>{deviceName(d, i)}</MenuItem>)}
              </TextField>
              {resolved.via === "unmapped" && <Typography variant="caption" sx={{ color: "warning.main" }} component="div">{t("studio.cameraMapWarnUnmappedShort")}</Typography>}
              {resolved.via === "missing" && entry && <Typography variant="caption" sx={{ color: "warning.main" }} component="div">{t("studio.cameraMapWarnMissing", { slot: slotName(slot), device: entry.label || entry.deviceId })}</Typography>}
              {(state === "failed" || state === "ended") && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ color: "error.main" }} role="alert">{t(state === "failed" ? "studio.cameraMapFailed" : "studio.cameraMapEnded", { slot: slotName(slot) })}</Typography>
                  {onRetry && <Button size="small" color="error" onClick={onRetry}>{t("studio.cameraMapRetry")}</Button>}
                </Stack>
              )}
            </Box>
            {preview && <CameraPreview entry={preview(resolved.device)} isDefault={resolved.device === DEFAULT_CAMERA_DEVICE} />}
          </Box>
        );
      })}
      {unmapped.length > 0 && (
        <Alert severity="warning" sx={{ py: compact ? 0 : undefined }}>
          {t("studio.cameraMapWarnUnmapped", { slots: unmapped.map(slotName).join("・") })}
        </Alert>
      )}
    </Stack>
  );
}

/** 128×72 のライブ見本。未割り当てなら既定のカメラを映して「既定」と重ねる */
function CameraPreview({ entry, isDefault }: { entry: CameraStreamEntry | undefined; isDefault: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLVideoElement>(null);
  const stream = entry?.stream ?? null;
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <Box sx={{ position: "relative", width: 128, height: 72, flexShrink: 0, borderRadius: 1, overflow: "hidden", bgcolor: "#111827", display: "grid", placeItems: "center" }}>
      {stream ? <video ref={ref} muted playsInline autoPlay style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <Typography variant="caption" sx={{ color: "#64748b" }}>{t("studio.cameraWaiting")}</Typography>}
      {isDefault && <Chip size="small" label={t("studio.cameraMapDefaultBadge")} sx={{ position: "absolute", left: 4, top: 4, height: 18, fontSize: 10, bgcolor: "rgba(0,0,0,0.6)", color: "#fff" }} />}
    </Box>
  );
}

/** ブラウザは使用を許可するまで機器名を返さない。一度だけ開いてすぐ止め、一覧を読み直す */
export async function requestCameraPermission(refresh: () => Promise<void>) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(track => track.stop());
  } catch {
    // 許可されなければ一覧は空のまま。案内を出し続ける
  }
  await refresh();
}

/**
 * 配信コントロールの「カメラの割り当て（このPC）」(#570)。
 *
 * 選んだ番号はこのPCのブラウザにだけ保存し、同じPCの配信画面は `storage` イベントで受け取る。
 * 配信画面の様子（開いているか・開けない番号）は BroadcastChannel で受け取る。
 * 配信画面（OBS が取り込む画面）には、この警告を何も出さない。
 */
export function LiveCameraMapCard({ eventId, liveSetId, liveSetName, content }: { eventId: string; liveSetId: string; liveSetName: string; content: LiveSetContent }) {
  const { t } = useTranslation();
  const [map, assign] = useCameraMap(liveSetId);
  const slots = usedCameraSlots(content);
  // 全部割り当て済みなら畳んで始め、未割り当てがあれば開いて始める（セットを替えたら呼ぶ側が key で作り直す）
  const [open, setOpen] = useState(() => !slots.every(slot => map[slot]));
  const { devices, permitted, refresh } = useVideoDevices(open);
  const screen = useScreenStatus(eventId, liveSetId);

  // 見本は枠を開いている間だけ、低い解像度で開く。未割り当ての番号は既定のカメラを映す
  const previewDevices = open && permitted ? slots.map(slot => resolveCameraDevice(map[slot], devices).device) : [];
  const previews = useCameraStreams(previewDevices, open && permitted, PREVIEW_CAMERA_VIDEO);

  if (slots.length === 0) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="camera-map-card">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle1" fontWeight={700}>{t("studio.cameraMapTitle")}</Typography>
        <Chip size="small" label={liveSetName} />
        <Typography variant="caption" sx={{ ml: "auto", display: "inline-flex", alignItems: "center", gap: 0.5, color: screen.open ? "success.main" : "text.secondary" }} data-testid="camera-map-screen-status">
          <Box component="span" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: screen.open ? "success.main" : "text.disabled" }} />
          {t(screen.open ? "studio.cameraMapScreenOpen" : "studio.cameraMapScreenMissing")}
        </Typography>
        <Button size="small" onClick={() => setOpen(o => !o)} aria-expanded={open}>{t(open ? "studio.cameraMapHide" : "studio.cameraMapShow")}</Button>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, mb: 1 }}>{t("studio.cameraMapIntro")}</Typography>
        {!screen.open && <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>{t("studio.cameraMapScreenMissingHelp", { action: t("studio.openLiveScreen") })}</Typography>}
        {!permitted && (
          <Alert severity="info" sx={{ mb: 1 }} action={<Button size="small" onClick={() => void requestCameraPermission(refresh)}>{t("studio.cameraMapAllow")}</Button>}>
            {t("studio.cameraMapPermission")}
          </Alert>
        )}
        <LiveCameraMapRows
          content={content}
          map={map}
          assign={assign}
          devices={devices}
          slotStates={screen.open ? screen.slotStates : undefined}
          onRetry={screen.retry}
          preview={permitted ? previews.get : undefined}
        />
      </Collapse>
    </Paper>
  );
}

/** 同じPCの配信画面の様子。配信画面は開いている間、数秒おきに知らせる */
function useScreenStatus(eventId: string, liveSetId: string) {
  const [last, setLast] = useState<{ at: number; liveSetId: string; slotStates: Partial<Record<LiveCameraSlot, CameraSlotState>> } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(cameraStatusChannelName(eventId));
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<CameraStatusMessage>) => {
      const msg = e.data;
      if (msg?.type === "screen") setLast({ at: Date.now(), liveSetId: msg.liveSetId, slotStates: Object.fromEntries(msg.slots.map(s => [s.slot, s.state])) });
      if (msg?.type === "screenClosed") setLast(null);
    };
    ch.postMessage({ type: "ping" } satisfies CameraStatusMessage);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); ch.close(); channel.current = null; };
  }, [eventId]);
  const open = last !== null && now - last.at < SCREEN_STALE_MS;
  return {
    open,
    slotStates: open && last?.liveSetId === liveSetId ? last.slotStates : undefined,
    retry: () => channel.current?.postMessage({ type: "retry" } satisfies CameraStatusMessage),
  };
}
