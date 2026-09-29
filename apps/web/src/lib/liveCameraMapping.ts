import { LIVE_CAMERA_SLOTS, liveCameraLabel, sceneCameraSlots, usedCameraSlots } from "@eventer/shared";
import type { LiveCameraSlot, LiveScene, LiveSetContent } from "@eventer/shared";

/**
 * 配信するPCでの「カメラ番号 → 機器」の割り当て (#570)。
 *
 * 配信セットは番号と呼び名だけを持つ。どの機器をどの番号にするかは PC とサイトごとに
 * 違う deviceId なので、配信するPCのブラウザ（localStorage）にだけ、配信セットごとに置く。
 * 配信コントロールと配信画面は同じオリジンなので、`storage` イベントで互いに反映する。
 */

/** #570 以前の「配信画面で選んだ1台」。割り当てのないセットのカメラ1の初期値に使う */
export const LEGACY_CAMERA_DEVICE_KEY = "eventer-live-camera-device";
const MAP_KEY_PREFIX = "eventer-live-camera-map:";

export interface LiveCameraMapEntry {
  deviceId: string;
  /** 選んだときの機器名。deviceId が変わったとき（サイトデータの削除など）に探し直す */
  label: string;
}
/** 割り当てのない番号は既定のカメラで映す */
export type LiveCameraMap = Partial<Record<LiveCameraSlot, LiveCameraMapEntry>>;

export const cameraMapStorageKey = (liveSetId: string) => `${MAP_KEY_PREFIX}${liveSetId}`;

/** 保存した割り当てを読む。壊れた値は捨てる。一度も保存していないセットは、
 * 以前の1台の選択をカメラ1に入れて返す（書き込みはしない）。 */
export function readCameraMap(liveSetId: string, storage: Storage = localStorage): LiveCameraMap {
  const raw = storage.getItem(cameraMapStorageKey(liveSetId));
  if (raw === null) {
    const legacy = storage.getItem(LEGACY_CAMERA_DEVICE_KEY);
    return legacy ? { 1: { deviceId: legacy, label: "" } } : {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map: LiveCameraMap = {};
    for (const slot of LIVE_CAMERA_SLOTS) {
      const entry = parsed?.[slot] as Partial<LiveCameraMapEntry> | undefined;
      if (entry && typeof entry.deviceId === "string" && entry.deviceId) {
        map[slot] = { deviceId: entry.deviceId, label: typeof entry.label === "string" ? entry.label : "" };
      }
    }
    return map;
  } catch {
    return {};
  }
}

export function writeCameraMap(liveSetId: string, map: LiveCameraMap, storage: Storage = localStorage) {
  storage.setItem(cameraMapStorageKey(liveSetId), JSON.stringify(map));
}

/** 番号の割り当てを1つ変えた写し。null は未割り当てに戻す */
export function withCameraMapEntry(map: LiveCameraMap, slot: LiveCameraSlot, entry: LiveCameraMapEntry | null): LiveCameraMap {
  const next = { ...map };
  if (entry) next[slot] = entry;
  else delete next[slot];
  return next;
}

/** 既定のカメラ（`video: true` で開くもの）を表す機器キー */
export const DEFAULT_CAMERA_DEVICE = "";

export type CameraResolution =
  /** 保存した deviceId の機器がある（一覧を読めないときも、そのまま使う） */
  | { device: string; via: "deviceId" }
  /** deviceId は見つからないが、同じ名前の機器がある */
  | { device: string; via: "label" }
  /** 未割り当て、または保存した機器がこのPCに見つからない */
  | { device: typeof DEFAULT_CAMERA_DEVICE; via: "unmapped" | "missing" };

/**
 * 番号を機器に解決する: 保存した deviceId → 同じ名前の機器 → 既定のカメラ。
 * `devices` は videoinput の一覧。使用の許可前は deviceId も名前も空なので、
 * そのときは保存した deviceId を信じて開いてみる（許可後に解決し直す）。
 */
export function resolveCameraDevice(entry: LiveCameraMapEntry | undefined, devices: readonly Pick<MediaDeviceInfo, "deviceId" | "label">[]): CameraResolution {
  if (!entry) return { device: DEFAULT_CAMERA_DEVICE, via: "unmapped" };
  const known = devices.some(d => d.deviceId || d.label);
  if (!known || devices.some(d => d.deviceId === entry.deviceId)) return { device: entry.deviceId, via: "deviceId" };
  const byLabel = entry.label ? devices.find(d => d.label === entry.label) : undefined;
  if (byLabel) return { device: byLabel.deviceId, via: "label" };
  return { device: DEFAULT_CAMERA_DEVICE, via: "missing" };
}

/** セットで使う番号それぞれの解決結果 */
export function resolveCameraSlots(slots: readonly LiveCameraSlot[], map: LiveCameraMap, devices: readonly Pick<MediaDeviceInfo, "deviceId" | "label">[]): Map<LiveCameraSlot, CameraResolution> {
  return new Map(slots.map(slot => [slot, resolveCameraDevice(map[slot], devices)]));
}

/** 編集画面で選べるカメラ番号の候補 */
export interface CameraSlotChoices {
  /** このセットにある番号（使っている、または呼び名がある）。小さい順 */
  existing: LiveCameraSlot[];
  /** 「新しいカメラ」の番号。上限に達していれば null */
  next: LiveCameraSlot | null;
}

export function cameraSlotChoices(content: LiveSetContent, current?: LiveCameraSlot): CameraSlotChoices {
  const set = new Set<LiveCameraSlot>([...usedCameraSlots(content), ...(content.cameras ?? []).map(c => c.slot as LiveCameraSlot)]);
  const next = LIVE_CAMERA_SLOTS.find(s => !set.has(s)) ?? null;
  // 選んでいる番号がまだセットに無く「新しいカメラ」でもないとき（例: 1 を飛ばして 2）は、候補に並べて見せる
  if (current && current !== next) set.add(current);
  return { existing: [...set].sort((a, b) => a - b), next };
}

/** 追加するカメラの既定の番号: シーンにカメラがなければ1、あればそのシーンで使っていない一番小さい番号 */
export function defaultCameraSlotForScene(scene: LiveScene | undefined): LiveCameraSlot {
  if (!scene) return 1;
  const used = new Set(sceneCameraSlots(scene));
  if (used.size === 0) return 1;
  return LIVE_CAMERA_SLOTS.find(s => !used.has(s)) ?? 1;
}

/** 呼び名を変えた写し。空にしたら消す（何も付けていないセットに空の欄を残さない） */
export function withCameraLabel(content: LiveSetContent, slot: LiveCameraSlot, label: string): LiveSetContent {
  const rest = (content.cameras ?? []).filter(c => c.slot !== slot);
  const cameras = label ? [...rest, { slot, label }].sort((a, b) => a.slot - b.slot) : rest;
  if (cameras.length === 0) {
    const { cameras: _removed, ...withoutCameras } = content;
    return withoutCameras;
  }
  return { ...content, cameras };
}

/** 番号ごとの呼び名（付けていないものは入れない） */
export function cameraLabels(content: LiveSetContent | undefined): Partial<Record<LiveCameraSlot, string>> {
  const labels: Partial<Record<LiveCameraSlot, string>> = {};
  if (!content) return labels;
  for (const slot of LIVE_CAMERA_SLOTS) {
    const label = liveCameraLabel(content, slot);
    if (label) labels[slot] = label;
  }
  return labels;
}

/** 番号の色。編集画面・コントロールのバッジとプレースホルダーの枠で同じ色を使う */
export const CAMERA_SLOT_COLORS: Record<LiveCameraSlot, string> = { 1: "#FB923C", 2: "#2DD4BF", 3: "#A78BFA", 4: "#FBBF24" };

/** 配信画面から同じPCの配信コントロールへ送る状態の通り道 */
export const cameraStatusChannelName = (eventId: string) => `eventer-live-camera:${eventId}`;

export type CameraSlotState = "opening" | "live" | "failed" | "ended";
export type CameraStatusMessage =
  | { type: "screen"; liveSetId: string; slots: { slot: LiveCameraSlot; via: CameraResolution["via"]; state: CameraSlotState }[] }
  | { type: "screenClosed" }
  | { type: "ping" }
  | { type: "retry" };
