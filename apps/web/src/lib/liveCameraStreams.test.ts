import { describe, expect, it, vi } from "vitest";
import { LIVE_CAMERA_VIDEO, LiveCameraStreams } from "./liveCameraStreams.js";

/** getUserMedia の代わり。開いた機器と、止めたトラックを数える */
function fakeMedia() {
  const opened: MediaStreamConstraints[] = [];
  const pending: { device: string; resolve: () => void; reject: () => void }[] = [];
  const tracks: { device: string; stop: ReturnType<typeof vi.fn>; end: () => void }[] = [];
  const getUserMedia = (constraints: MediaStreamConstraints) => {
    opened.push(constraints);
    const video = constraints.video as MediaTrackConstraints;
    const device = (video.deviceId as { exact: string } | undefined)?.exact ?? "";
    return new Promise<MediaStream>((resolve, reject) => {
      pending.push({
        device,
        resolve: () => {
          const listeners: (() => void)[] = [];
          const track = { stop: vi.fn(), addEventListener: (_: string, fn: () => void) => listeners.push(fn) };
          tracks.push({ device, stop: track.stop, end: () => listeners.forEach(fn => fn()) });
          resolve({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream);
        },
        reject: () => reject(new Error("NotReadableError")),
      });
    });
  };
  const flush = async () => { for (const p of pending.splice(0)) p.resolve(); await Promise.resolve(); await Promise.resolve(); };
  return { opened, pending, tracks, getUserMedia, flush };
}

describe("配信画面のカメラの集まり (#570)", () => {
  it("同じ機器は何本の枠・番号が使っても1回だけ開く。720p を目安に開く", async () => {
    const media = fakeMedia();
    const pool = new LiveCameraStreams(media.getUserMedia, () => {});
    // カメラ1・カメラ2 が同じ機器、カメラ3・カメラ4 が未割り当て（既定のカメラ）
    pool.sync(["dev-a", "dev-a", "", ""]);
    pool.sync(["dev-a", ""]);
    await media.flush();
    expect(media.opened).toHaveLength(2);
    expect(media.opened).toContainEqual({ video: { ...LIVE_CAMERA_VIDEO, deviceId: { exact: "dev-a" } }, audio: false });
    expect(media.opened).toContainEqual({ video: LIVE_CAMERA_VIDEO, audio: false });
    expect(pool.get("dev-a")?.state).toBe("live");
    expect(pool.get("dev-a")?.stream).toBeTruthy();
  });

  it("使わなくなった機器だけを止め、閉じたら全部止める", async () => {
    const media = fakeMedia();
    const pool = new LiveCameraStreams(media.getUserMedia, () => {});
    pool.sync(["dev-a", "dev-b"]);
    await media.flush();
    pool.sync(["dev-b"]);
    expect(media.tracks.find(t => t.device === "dev-a")?.stop).toHaveBeenCalled();
    expect(media.tracks.find(t => t.device === "dev-b")?.stop).not.toHaveBeenCalled();
    expect(pool.get("dev-a")).toBeUndefined();
    expect(media.opened).toHaveLength(2);
    pool.stopAll();
    expect(media.tracks.find(t => t.device === "dev-b")?.stop).toHaveBeenCalled();
  });

  it("開いている途中で要らなくなった機器は、開けた瞬間に止める", async () => {
    const media = fakeMedia();
    const pool = new LiveCameraStreams(media.getUserMedia, () => {});
    pool.sync(["dev-a"]);
    pool.sync([]);
    await media.flush();
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(pool.get("dev-a")).toBeUndefined();
  });

  it("開けない機器は failed、止まった機器は ended。再試行でその機器だけ開き直す", async () => {
    const media = fakeMedia();
    const onChange = vi.fn();
    const pool = new LiveCameraStreams(media.getUserMedia, onChange);
    pool.sync(["dev-a", "dev-b"]);
    media.pending.find(p => p.device === "dev-a")!.reject();
    media.pending.splice(media.pending.findIndex(p => p.device === "dev-a"), 1);
    await media.flush();
    expect(pool.get("dev-a")?.state).toBe("failed");
    expect(pool.get("dev-b")?.state).toBe("live");
    media.tracks.find(t => t.device === "dev-b")!.end();
    expect(pool.get("dev-b")).toMatchObject({ state: "ended", stream: null });
    expect(onChange).toHaveBeenCalled();
    pool.retryFailed();
    expect(media.opened.map(c => ((c.video as MediaTrackConstraints).deviceId as { exact: string }).exact)).toEqual(["dev-a", "dev-b", "dev-a", "dev-b"]);
    await media.flush();
    expect(pool.get("dev-a")?.state).toBe("live");
    expect(pool.get("dev-b")?.state).toBe("live");
  });
});
