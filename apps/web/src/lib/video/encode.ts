import {
  BufferTarget,
  Conversion,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
} from "mediabunny";
import { EVENT_VIDEO_MAX_BYTES } from "@eventer/shared";
import {
  AUDIO_BITRATE_OPUS,
  VIDEO_BITRATE,
  VIDEO_TARGET_FPS,
  computeTargetDims,
  type VideoPlan,
} from "./plan.js";
import type { ProbedVideo } from "./probe.js";

/**
 * 変換の実行 (#408)。mediabunny の Conversion を薄く包む。
 *
 * - コーデック処理はブラウザの WebCodecs（多くはハードウェア支援）
 * - 入力が既に出力条件を満たすトラックは mediabunny が無変換コピーする。
 *   それを妨げないよう、resize / frameRate は必要なときだけ指定する
 */

export type EncodePlan = Extract<VideoPlan, { kind: "encode" }>;

export type VideoEncodeOutput = {
  blob: Blob;
  mime: "video/webm" | "video/mp4";
  width: number;
  height: number;
};

export type VideoEncoder408Handle = {
  /** 実行できない場合の理由（対応コーデックなし等）。null なら実行可能 */
  invalidReason: string | null;
  /** 出力から外れたトラックと理由（計測・デバッグ表示用） */
  discardedTracks: { type: string; codec: string | null; reason: string }[];
  /** 変換を実行して出力を返す。invalidReason があるときは throw する */
  execute: () => Promise<VideoEncodeOutput>;
  /** 進行中の変換を中断する */
  cancel: () => Promise<void>;
};

export type CreateVideoConversionOptions = {
  /** 0–1 の進捗。エンコード進捗バーに使う */
  onProgress?: (progress: number) => void;
  /** true なら入力が条件を満たしていても映像を再エンコードする（計測用） */
  forceTranscodeVideo?: boolean;
};

/** 変換を準備する。実行は返り値の execute() で行う */
export async function createVideoConversion(
  probed: ProbedVideo,
  plan: EncodePlan,
  options: CreateVideoConversionOptions = {},
): Promise<VideoEncoder408Handle> {
  const { input, probe, approxFps } = probed;

  const format = plan.container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });

  const dims = computeTargetDims(probe.width, probe.height);
  const needsResize = dims.width !== probe.width || dims.height !== probe.height;
  // fps は先頭パケットからの概算しか分からないので、明らかに超えるときだけ絞る
  const needsFpsCap = approxFps !== null && approxFps > VIDEO_TARGET_FPS + 0.5;

  const video: ConversionVideoOptions = {
    codec: plan.videoCodec,
    quality: new Quality({ bitrate: VIDEO_BITRATE[plan.videoCodec] }),
    ...(needsResize ? { width: dims.width, height: dims.height, fit: "contain" as const } : {}),
    ...(needsFpsCap ? { frameRate: VIDEO_TARGET_FPS } : {}),
    ...(options.forceTranscodeVideo ? { forceTranscode: true } : {}),
  };

  const audio: ConversionAudioOptions =
    plan.audio === "none"
      ? { discard: true }
      : plan.audio === "aac-copy"
        ? {} // AAC は MP4 にそのまま箱詰めできる（再エンコードしない）
        : { codec: "opus", quality: new Quality({ bitrate: AUDIO_BITRATE_OPUS }) };

  const conversion = await Conversion.init({
    input,
    output,
    video,
    audio,
    showWarnings: false,
  });

  const discardedTracks = conversion.discardedTracks.map((d) => ({
    type: d.track.type,
    codec: d.track.codec,
    reason: d.reason,
  }));

  const invalidReason = conversion.isValid
    ? null
    : discardedTracks.map((d) => `${d.type}(${d.codec ?? "?"}): ${d.reason}`).join(", ") ||
      "conversion invalid";

  if (options.onProgress) {
    const cb = options.onProgress;
    conversion.onProgress = (p) => cb(p);
  }

  const mime = plan.container === "webm" ? "video/webm" : "video/mp4";

  return {
    invalidReason,
    discardedTracks,
    cancel: () => conversion.cancel(),
    execute: async () => {
      await conversion.execute();
      const buffer = target.buffer;
      if (!buffer) throw new Error("変換結果が空でした");
      if (buffer.byteLength > EVENT_VIDEO_MAX_BYTES) {
        throw new Error(
          `変換後のサイズが上限を超えました (${buffer.byteLength} > ${EVENT_VIDEO_MAX_BYTES})`,
        );
      }
      return {
        blob: new Blob([buffer], { type: mime }),
        mime,
        width: needsResize ? dims.width : probe.width,
        height: needsResize ? dims.height : probe.height,
      };
    },
  };
}
