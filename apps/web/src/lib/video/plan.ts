import {
  EVENT_VIDEO_MAX_BYTES,
  EVENT_VIDEO_MAX_DURATION_MS,
} from "@eventer/shared";

/**
 * 動画変換の経路決定 (#408)。
 *
 * ここは純関数だけを置く（ユニットテストの主対象）。
 * ブラウザ能力の実測（WebCodecs / mediabunny）は probe.ts、
 * 変換の実行は encode.ts が担う。
 *
 * 経路の優先順位（docs/video-upload.md §4.1）:
 *   1. WebM（VP9→VP8 + Opus）… VideoEncoder と AudioEncoder が両方ある環境
 *   2. MP4（H.264 + AAC パススルー）… VideoEncoder だけの環境（Safari 16.4–18）
 *   3. そのまま受理 … WebCodecs なし/デコード不可でも、元が MP4/WebM かつ上限内
 *   それ以外は明確なエラー
 */

/** 変換後の長辺上限（720p 相当） */
export const VIDEO_TARGET_MAX_DIM = 1280;
/** 変換後のフレームレート上限 */
export const VIDEO_TARGET_FPS = 30;
/** 映像ビットレート目標（bps）。VP9 は圧縮効率が良いぶん低め */
export const VIDEO_BITRATE = { vp9: 2_000_000, vp8: 2_500_000, avc: 2_500_000 } as const;
/** 音声（Opus）ビットレート目標（bps） */
export const AUDIO_BITRATE_OPUS = 96_000;

/** ブラウザのエンコード能力（probe.ts が実測して埋める） */
export type VideoCapability = {
  /** WebCodecs VideoEncoder があるか */
  hasVideoEncoder: boolean;
  canEncodeVp9: boolean;
  canEncodeVp8: boolean;
  canEncodeH264: boolean;
  /** WebCodecs AudioEncoder で Opus をエンコードできるか */
  canEncodeOpus: boolean;
};

/** 入力ファイルの検分結果（probe.ts が demux して埋める）。
 * demux は WebCodecs なしでもできるため、どの環境でも得られる */
export type VideoInputProbe = {
  container: "mp4" | "webm" | "mov" | "other";
  fileBytes: number;
  durationMs: number;
  /** 映像トラックがあるか。ないもの（音声だけ等）は動画として受けない */
  hasVideoTrack: boolean;
  width: number;
  height: number;
  videoCodec: string | null;
  /** null = 音声トラックなし */
  audioCodec: string | null;
  canDecodeVideo: boolean;
  canDecodeAudio: boolean;
};

export type VideoRejectReason =
  | "too-long"
  | "too-large"
  | "no-video-track"
  | "cannot-process";

export type VideoPlan =
  | {
      kind: "encode";
      container: "webm";
      videoCodec: "vp9" | "vp8";
      audio: "opus" | "none";
      /** 音声があるのに落とす場合 true（投稿前に利用者へ確認する） */
      confirmDropAudio: boolean;
    }
  | {
      kind: "encode";
      container: "mp4";
      videoCodec: "avc";
      /** aac-copy = 入力の AAC を再エンコードせずそのまま箱詰めする */
      audio: "aac-copy" | "none";
      confirmDropAudio: boolean;
    }
  | { kind: "passthrough"; mime: "video/webm" | "video/mp4" }
  | { kind: "reject"; reason: VideoRejectReason };

/**
 * 環境と入力から変換経路を決める。
 * 上限（長さ・サイズ）は @eventer/shared の定数が唯一の契約。
 */
export function decideVideoPlan(
  support: VideoCapability,
  probe: VideoInputProbe,
): VideoPlan {
  if (!probe.hasVideoTrack) {
    return { kind: "reject", reason: "no-video-track" };
  }
  // 長さは demux だけで分かるので、どの経路よりも先に弾く
  if (probe.durationMs > EVENT_VIDEO_MAX_DURATION_MS) {
    return { kind: "reject", reason: "too-long" };
  }

  const hasAudio = probe.audioCodec !== null;

  // 経路1: WebM（VP9→VP8 + Opus）
  if (
    probe.canDecodeVideo &&
    support.hasVideoEncoder &&
    (support.canEncodeVp9 || support.canEncodeVp8) &&
    support.canEncodeOpus
  ) {
    const videoCodec = support.canEncodeVp9 ? "vp9" : "vp8";
    if (!hasAudio) {
      return { kind: "encode", container: "webm", videoCodec, audio: "none", confirmDropAudio: false };
    }
    if (probe.canDecodeAudio) {
      return { kind: "encode", container: "webm", videoCodec, audio: "opus", confirmDropAudio: false };
    }
    // 音声だけデコードできない（珍しいコーデック等）→ 落とすかを確認して映像のみ
    return { kind: "encode", container: "webm", videoCodec, audio: "none", confirmDropAudio: true };
  }

  // 経路2: MP4（H.264 + AAC パススルー）。AAC はデコード不要でそのまま箱詰めできる
  if (probe.canDecodeVideo && support.hasVideoEncoder && support.canEncodeH264) {
    if (!hasAudio) {
      return { kind: "encode", container: "mp4", videoCodec: "avc", audio: "none", confirmDropAudio: false };
    }
    if (probe.audioCodec === "aac") {
      return { kind: "encode", container: "mp4", videoCodec: "avc", audio: "aac-copy", confirmDropAudio: false };
    }
    return { kind: "encode", container: "mp4", videoCodec: "avc", audio: "none", confirmDropAudio: true };
  }

  // 経路3: 変換できない環境/入力でも、元が MP4/WebM かつ上限内ならそのまま受ける
  if (probe.container === "mp4" || probe.container === "webm") {
    if (probe.fileBytes > EVENT_VIDEO_MAX_BYTES) {
      return { kind: "reject", reason: "too-large" };
    }
    return {
      kind: "passthrough",
      mime: probe.container === "mp4" ? "video/mp4" : "video/webm",
    };
  }

  return { kind: "reject", reason: "cannot-process" };
}

/** 長辺を maxDim に収めた出力サイズ。拡大はしない。
 * エンコーダが扱いやすいよう偶数に丸める */
export function computeTargetDims(
  width: number,
  height: number,
  maxDim = VIDEO_TARGET_MAX_DIM,
): { width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height, 1));
  const even = (n: number) => Math.max(2, 2 * Math.round((n * scale) / 2));
  return { width: even(width), height: even(height) };
}
