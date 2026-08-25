import { describe, expect, it } from "vitest";
import {
  EVENT_VIDEO_MAX_BYTES,
  EVENT_VIDEO_MAX_DURATION_MS,
} from "@eventer/shared";
import {
  computeTargetDims,
  decideVideoPlan,
  type VideoCapability,
  type VideoInputProbe,
} from "./plan.js";

/** docs/video-upload.md §10 のマトリクス:
 * （WebCodecs フル / video のみ / なし）×（WebM 入力 / H.264 mov / HEVC mov /
 * 上限超過）→ 期待経路を全列挙する */

const full: VideoCapability = {
  hasVideoEncoder: true,
  canEncodeVp9: true,
  canEncodeVp8: true,
  canEncodeH264: true,
  canEncodeOpus: true,
};
// Safari 16.4–18 系: VideoEncoder はあるが AudioEncoder(Opus) が無い
const videoOnly: VideoCapability = { ...full, canEncodeOpus: false };
// Firefox Android: WebCodecs 丸ごと無し
const none: VideoCapability = {
  hasVideoEncoder: false,
  canEncodeVp9: false,
  canEncodeVp8: false,
  canEncodeH264: false,
  canEncodeOpus: false,
};

const base: VideoInputProbe = {
  container: "mov",
  fileBytes: 30 * 1024 * 1024,
  durationMs: 30_000,
  hasVideoTrack: true,
  width: 1920,
  height: 1080,
  videoCodec: "avc",
  audioCodec: "aac",
  canDecodeVideo: true,
  canDecodeAudio: true,
};

describe("decideVideoPlan", () => {
  it("フル対応 × H.264 mov → WebM (VP9 + Opus)", () => {
    expect(decideVideoPlan(full, base)).toEqual({
      kind: "encode",
      container: "webm",
      videoCodec: "vp9",
      audio: "opus",
      confirmDropAudio: false,
    });
  });

  it("VP9 が使えない端末は VP8 に落とす", () => {
    const plan = decideVideoPlan({ ...full, canEncodeVp9: false }, base);
    expect(plan).toMatchObject({ kind: "encode", container: "webm", videoCodec: "vp8" });
  });

  it("フル対応 × WebM 入力 → WebM（mediabunny 側で無変換コピーになる想定）", () => {
    const probe: VideoInputProbe = {
      ...base,
      container: "webm",
      videoCodec: "vp9",
      audioCodec: "opus",
    };
    expect(decideVideoPlan(full, probe)).toMatchObject({ kind: "encode", container: "webm" });
  });

  it("音声なし入力 → WebM 映像のみ（確認不要）", () => {
    const plan = decideVideoPlan(full, { ...base, audioCodec: null, canDecodeAudio: false });
    expect(plan).toEqual({
      kind: "encode",
      container: "webm",
      videoCodec: "vp9",
      audio: "none",
      confirmDropAudio: false,
    });
  });

  it("音声だけデコード不可 → 音声を落とす前に確認する", () => {
    const plan = decideVideoPlan(full, { ...base, audioCodec: "unknown", canDecodeAudio: false });
    expect(plan).toEqual({
      kind: "encode",
      container: "webm",
      videoCodec: "vp9",
      audio: "none",
      confirmDropAudio: true,
    });
  });

  it("video のみ対応（Safari 16.4–18） × AAC mov → MP4 (H.264 + AAC パススルー)", () => {
    expect(decideVideoPlan(videoOnly, base)).toEqual({
      kind: "encode",
      container: "mp4",
      videoCodec: "avc",
      audio: "aac-copy",
      confirmDropAudio: false,
    });
  });

  it("video のみ対応 × AAC 以外の音声 → MP4 映像のみ（音声を落とす確認つき）", () => {
    const plan = decideVideoPlan(videoOnly, { ...base, audioCodec: "flac" });
    expect(plan).toEqual({
      kind: "encode",
      container: "mp4",
      videoCodec: "avc",
      audio: "none",
      confirmDropAudio: true,
    });
  });

  it("video のみ対応 × 音声なし → MP4 映像のみ（確認不要）", () => {
    const plan = decideVideoPlan(videoOnly, { ...base, audioCodec: null, canDecodeAudio: false });
    expect(plan).toEqual({
      kind: "encode",
      container: "mp4",
      videoCodec: "avc",
      audio: "none",
      confirmDropAudio: false,
    });
  });

  it("WebCodecs なし × MP4 入力（上限内） → そのまま受理", () => {
    const plan = decideVideoPlan(none, { ...base, container: "mp4", canDecodeVideo: false, canDecodeAudio: false });
    expect(plan).toEqual({ kind: "passthrough", mime: "video/mp4" });
  });

  it("WebCodecs なし × WebM 入力（上限内） → そのまま受理", () => {
    const plan = decideVideoPlan(none, {
      ...base,
      container: "webm",
      videoCodec: "vp9",
      audioCodec: "opus",
      canDecodeVideo: false,
      canDecodeAudio: false,
    });
    expect(plan).toEqual({ kind: "passthrough", mime: "video/webm" });
  });

  it("WebCodecs なし × mov 入力 → 不可", () => {
    const plan = decideVideoPlan(none, { ...base, canDecodeVideo: false, canDecodeAudio: false });
    expect(plan).toEqual({ kind: "reject", reason: "cannot-process" });
  });

  it("WebCodecs なし × MP4 入力でもサイズ超過 → 不可（too-large）", () => {
    const plan = decideVideoPlan(none, {
      ...base,
      container: "mp4",
      fileBytes: EVENT_VIDEO_MAX_BYTES + 1,
      canDecodeVideo: false,
      canDecodeAudio: false,
    });
    expect(plan).toEqual({ kind: "reject", reason: "too-large" });
  });

  it("HEVC が HW デコードできない環境 × mov → 不可", () => {
    const plan = decideVideoPlan(full, { ...base, videoCodec: "hevc", canDecodeVideo: false });
    expect(plan).toEqual({ kind: "reject", reason: "cannot-process" });
  });

  it("HEVC がデコードできなくても入力が MP4 なら上限内でそのまま受理", () => {
    const plan = decideVideoPlan(full, {
      ...base,
      container: "mp4",
      videoCodec: "hevc",
      canDecodeVideo: false,
    });
    expect(plan).toEqual({ kind: "passthrough", mime: "video/mp4" });
  });

  it("長さ超過はどの環境・どの入力でも先に弾く", () => {
    const over = { ...base, durationMs: EVENT_VIDEO_MAX_DURATION_MS + 1 };
    expect(decideVideoPlan(full, over)).toEqual({ kind: "reject", reason: "too-long" });
    expect(decideVideoPlan(videoOnly, over)).toEqual({ kind: "reject", reason: "too-long" });
    expect(
      decideVideoPlan(none, { ...over, container: "mp4", canDecodeVideo: false }),
    ).toEqual({ kind: "reject", reason: "too-long" });
  });

  it("ちょうど上限（60秒・上限バイト）は通す", () => {
    expect(
      decideVideoPlan(full, { ...base, durationMs: EVENT_VIDEO_MAX_DURATION_MS }),
    ).toMatchObject({ kind: "encode" });
    expect(
      decideVideoPlan(none, {
        ...base,
        container: "mp4",
        fileBytes: EVENT_VIDEO_MAX_BYTES,
        canDecodeVideo: false,
      }),
    ).toEqual({ kind: "passthrough", mime: "video/mp4" });
  });

  it("映像トラックがないファイルは受けない", () => {
    const plan = decideVideoPlan(full, {
      ...base,
      hasVideoTrack: false,
      videoCodec: null,
      canDecodeVideo: false,
    });
    expect(plan).toEqual({ kind: "reject", reason: "no-video-track" });
  });
});

describe("computeTargetDims", () => {
  it("1080p 横 → 1280x720", () => {
    expect(computeTargetDims(1920, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it("1080p 縦 → 720x1280", () => {
    expect(computeTargetDims(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it("4K → 長辺 1280", () => {
    expect(computeTargetDims(3840, 2160)).toEqual({ width: 1280, height: 720 });
  });

  it("上限以下は拡大しない", () => {
    expect(computeTargetDims(640, 360)).toEqual({ width: 640, height: 360 });
    expect(computeTargetDims(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("奇数は偶数に丸める（エンコーダ対策）", () => {
    const dims = computeTargetDims(1279, 719);
    expect(dims.width % 2).toBe(0);
    expect(dims.height % 2).toBe(0);
  });
});
