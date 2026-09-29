import { DEFAULT_CAMERA_DEVICE } from "./liveCameraMapping.js";
import type { CameraSlotState } from "./liveCameraMapping.js";

/**
 * 配信画面で開いているカメラの集まり (#570)。
 *
 * 異なる機器ごとに getUserMedia を1回だけ呼び、同じ機器に解決された番号は1本を共有する。
 * セットで使う機器は開いたままにして、シーンの切り替えで黒い枠を出さない。
 * 使わなくなった機器は止め、閉じるときは全部止める。
 *
 * 機器は文字列のキーで持つ。`DEFAULT_CAMERA_DEVICE`（空文字）は既定のカメラ。
 */
export interface CameraStreamEntry {
  state: CameraSlotState;
  stream: MediaStream | null;
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/** 配信用は 720p を目安に開き、4台同時でも PC の負荷を抑える */
export const LIVE_CAMERA_VIDEO: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
/** 配信コントロールの小さな見本用 */
export const PREVIEW_CAMERA_VIDEO: MediaTrackConstraints = { width: { ideal: 320 }, height: { ideal: 180 } };

export class LiveCameraStreams {
  private entries = new Map<string, CameraStreamEntry>();
  private wanted = new Set<string>();
  private disposed = false;

  constructor(
    private readonly getUserMedia: GetUserMedia,
    private readonly onChange: () => void,
    private readonly video: MediaTrackConstraints = LIVE_CAMERA_VIDEO,
  ) {}

  get(device: string): CameraStreamEntry | undefined {
    return this.entries.get(device);
  }

  /** 開いておく機器を揃える。足りないものを開き、要らなくなったものを止める */
  sync(devices: Iterable<string>) {
    if (this.disposed) return;
    this.wanted = new Set(devices);
    for (const [device, entry] of this.entries) {
      if (!this.wanted.has(device)) {
        stopStream(entry.stream);
        this.entries.delete(device);
      }
    }
    for (const device of this.wanted) {
      if (!this.entries.has(device)) this.open(device);
    }
    this.onChange();
  }

  /** 開けなかった・止まった機器を開き直す（devicechange や「再試行」） */
  retryFailed() {
    for (const [device, entry] of this.entries) {
      if (entry.state === "failed" || entry.state === "ended") {
        this.entries.delete(device);
        this.open(device);
      }
    }
    this.onChange();
  }

  stopAll() {
    this.disposed = true;
    for (const entry of this.entries.values()) stopStream(entry.stream);
    this.entries.clear();
  }

  private open(device: string) {
    const entry: CameraStreamEntry = { state: "opening", stream: null };
    this.entries.set(device, entry);
    const video = device === DEFAULT_CAMERA_DEVICE ? this.video : { ...this.video, deviceId: { exact: device } };
    this.getUserMedia({ video, audio: false }).then(
      stream => {
        // 開いている間に要らなくなった・閉じた・開き直した
        if (this.disposed || this.entries.get(device) !== entry) { stopStream(stream); return; }
        entry.stream = stream;
        entry.state = "live";
        for (const track of stream.getVideoTracks()) {
          track.addEventListener("ended", () => {
            if (this.entries.get(device) !== entry) return;
            entry.state = "ended";
            entry.stream = null;
            this.onChange();
          });
        }
        this.onChange();
      },
      () => {
        if (this.disposed || this.entries.get(device) !== entry) return;
        entry.state = "failed";
        this.onChange();
      },
    );
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}
