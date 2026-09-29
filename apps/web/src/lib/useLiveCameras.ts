import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveCameraSlot } from "@eventer/shared";
import { cameraMapStorageKey, readCameraMap, withCameraMapEntry, writeCameraMap } from "./liveCameraMapping.js";
import type { LiveCameraMap, LiveCameraMapEntry } from "./liveCameraMapping.js";
import { LiveCameraStreams } from "./liveCameraStreams.js";
import type { CameraStreamEntry } from "./liveCameraStreams.js";

/**
 * このPCの割り当て (#570)。同じPCの別のタブ（配信コントロールと配信画面）で変えた分は
 * `storage` イベントで受け取る。保存ボタンは無く、選んだ時点で書く。
 */
export function useCameraMap(liveSetId: string | undefined): [LiveCameraMap, (slot: LiveCameraSlot, entry: LiveCameraMapEntry | null) => void] {
  const [map, setMap] = useState<LiveCameraMap>(() => (liveSetId ? readCameraMap(liveSetId) : {}));
  useEffect(() => {
    if (!liveSetId) { setMap({}); return; }
    setMap(readCameraMap(liveSetId));
    const key = cameraMapStorageKey(liveSetId);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key || e.key === null) setMap(readCameraMap(liveSetId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [liveSetId]);
  const assign = useCallback((slot: LiveCameraSlot, entry: LiveCameraMapEntry | null) => {
    if (!liveSetId) return;
    const next = withCameraMapEntry(readCameraMap(liveSetId), slot, entry);
    writeCameraMap(liveSetId, next);
    setMap(next);
  }, [liveSetId]);
  return [map, assign];
}

/** このPCのカメラの一覧。抜き挿し（devicechange）のたびに読み直す */
export function useVideoDevices(enabled: boolean, onDeviceChange?: () => void) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const onChangeRef = useRef(onDeviceChange);
  onChangeRef.current = onDeviceChange;
  const refresh = useCallback(async () => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    try {
      const list = await media.enumerateDevices();
      setDevices(list.filter(d => d.kind === "videoinput"));
    } catch {
      setDevices([]);
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const onChange = () => { void refresh(); onChangeRef.current?.(); };
    media.addEventListener("devicechange", onChange);
    return () => media.removeEventListener("devicechange", onChange);
  }, [enabled, refresh]);
  /** 使用を許可するまで、ブラウザは機器名も deviceId も返さない */
  const permitted = devices.some(d => d.label);
  return { devices, permitted, refresh };
}

/**
 * 機器ごとに1本だけ開いたストリーム。`devices` に無くなった機器は止め、画面を閉じたら全部止める。
 * `enabled` が false の間は何も開かない。
 */
export function useCameraStreams(devices: readonly string[], enabled: boolean, video?: MediaTrackConstraints) {
  const [pool, setPool] = useState<LiveCameraStreams | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!enabled || !media?.getUserMedia) { setPool(null); return; }
    const next = new LiveCameraStreams(c => media.getUserMedia(c), () => bump(v => v + 1), video);
    setPool(next);
    return () => next.stopAll();
    // 目安の解像度は呼ぶ側が固定の値を渡すので、開き直しの合図にしない
  }, [enabled]);
  // 既定のカメラは空文字なので、区切り文字で繋がず JSON で比べる
  const key = JSON.stringify([...new Set(devices)].sort());
  useEffect(() => {
    pool?.sync(JSON.parse(key) as string[]);
  }, [pool, key]);
  const get = useCallback((device: string): CameraStreamEntry | undefined => pool?.get(device), [pool]);
  const retryFailed = useCallback(() => pool?.retryFailed(), [pool]);
  return { get, retryFailed };
}
