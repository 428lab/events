import {
  ALL_FORMATS,
  BlobSource,
  Input,
  Mp4InputFormat,
  Quality,
  QuickTimeInputFormat,
  WebMInputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import {
  AUDIO_BITRATE_OPUS,
  VIDEO_BITRATE,
  computeTargetDims,
  type VideoCapability,
  type VideoInputProbe,
} from "./plan.js";

/**
 * 入力ファイルとブラウザ能力の実測 (#408)。
 *
 * ここは「環境に触る」側。集めた事実を plan.ts の純関数に渡して経路を決める。
 * demux（コンテナ解析）は WebCodecs が無い環境でも動くため、
 * 長さ・解像度の上限チェックはどのブラウザでもできる。
 */

/** probe と、その後の変換・ポスター切り出しで使い回す Input のペア */
export type ProbedVideo = {
  input: Input;
  probe: VideoInputProbe;
  /** おおよそのフレームレート（先頭パケットからの実測。取れなければ null） */
  approxFps: number | null;
};

/** ファイルを demux してメタデータを読む。壊れたファイル等は throw する */
export async function probeVideoFile(file: File): Promise<ProbedVideo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const format = await input.getFormat();
  // WebM は Matroska の派生なので instanceof の順序に意味はないが、
  // mp4 と mov（QuickTime）は別クラス
  const container = (
    format instanceof Mp4InputFormat ? "mp4"
    : format instanceof WebMInputFormat ? "webm"
    : format instanceof QuickTimeInputFormat ? "mov"
    : "other"
  ) satisfies VideoInputProbe["container"];

  const [videoTrack, audioTrack, durationSec] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
    input.computeDuration(),
  ]);

  let approxFps: number | null = null;
  if (videoTrack) {
    try {
      const stats = await videoTrack.computePacketStats(100);
      approxFps = stats.averagePacketRate || null;
    } catch {
      approxFps = null;
    }
  }

  const probe: VideoInputProbe = {
    container,
    fileBytes: file.size,
    durationMs: Math.round(durationSec * 1000),
    hasVideoTrack: videoTrack !== null,
    width: videoTrack?.displayWidth ?? 0,
    height: videoTrack?.displayHeight ?? 0,
    videoCodec: videoTrack?.codec ?? null,
    audioCodec: audioTrack ? (audioTrack.codec ?? "unknown") : null,
    canDecodeVideo: videoTrack ? await videoTrack.canDecode() : false,
    canDecodeAudio: audioTrack ? await audioTrack.canDecode() : false,
  };
  return { input, probe, approxFps };
}

/**
 * この環境のエンコード能力を実測する。
 * VP9 対応はブラウザ・端末差が大きい（実地データで低め）ので、
 * 対応表を信じず必ず実サイズで canEncode を引く（docs/video-upload.md §2.1）。
 */
export async function detectVideoCapability(
  inputWidth: number,
  inputHeight: number,
): Promise<VideoCapability> {
  const hasVideoEncoder = typeof VideoEncoder !== "undefined";
  const hasAudioEncoder = typeof AudioEncoder !== "undefined";
  const dims = computeTargetDims(inputWidth || 1280, inputHeight || 720);

  const tryVideo = (codec: "vp9" | "vp8" | "avc") =>
    hasVideoEncoder
      ? canEncodeVideo(codec, {
          width: dims.width,
          height: dims.height,
          quality: new Quality({ bitrate: VIDEO_BITRATE[codec] }),
        }).catch(() => false)
      : Promise.resolve(false);

  const [canEncodeVp9, canEncodeVp8, canEncodeH264, canEncodeOpus] =
    await Promise.all([
      tryVideo("vp9"),
      tryVideo("vp8"),
      tryVideo("avc"),
      hasAudioEncoder
        ? canEncodeAudio("opus", {
            quality: new Quality({ bitrate: AUDIO_BITRATE_OPUS }),
          }).catch(() => false)
        : Promise.resolve(false),
    ]);

  return { hasVideoEncoder, canEncodeVp9, canEncodeVp8, canEncodeH264, canEncodeOpus };
}
