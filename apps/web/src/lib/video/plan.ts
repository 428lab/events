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

/** トリム範囲 (#425)。両端をミリ秒で持つ（長さ = endMs - startMs） */
export type VideoTrim = { startMs: number; endMs: number };

/** トリム UI を必須で開く条件（上限超え）。上限以内でも任意で開ける */
export function needsVideoTrim(durationMs: number): boolean {
  return durationMs > EVENT_VIDEO_MAX_DURATION_MS;
}

/** トリムの最短長。0秒の動画を作らせない（全長がこれ未満なら全長まで縮む） */
export const MIN_TRIM_MS = 1000;

/** 既定のトリム範囲: 先頭から上限いっぱい（全長が上限以内なら全範囲） */
export function defaultVideoTrim(totalMs: number): VideoTrim {
  return { startMs: 0, endMs: Math.min(totalMs, EVENT_VIDEO_MAX_DURATION_MS) };
}

/**
 * 2つまみスライダーの入力を「上限（60秒）以内・最短長以上・全長の内側」に
 * 正規化する (#425)。上限を超える範囲は**エラーにせず作れない**:
 * 動かしたつまみ（moved）を優先し、もう一方を追従させる。
 */
export function normalizeVideoTrim(
  startMs: number,
  endMs: number,
  totalMs: number,
  moved: "start" | "end",
): VideoTrim {
  const clamp = (v: number) => Math.min(Math.max(0, Math.round(v)), totalMs);
  let start = clamp(startMs);
  let end = clamp(endMs);
  if (start > end) [start, end] = [end, start];

  const minLen = Math.min(MIN_TRIM_MS, totalMs);
  if (end - start < minLen) {
    // 短すぎる範囲: 動かしたつまみの位置を保ち、もう一方を離す
    if (moved === "start") {
      end = Math.min(totalMs, start + minLen);
      start = end - minLen; // 末尾に張り付いたときは start 側を戻す
    } else {
      start = Math.max(0, end - minLen);
      end = start + minLen;
    }
  }
  if (end - start > EVENT_VIDEO_MAX_DURATION_MS) {
    // 上限超えの範囲: 動かしたつまみを優先し、もう一方が追従する
    if (moved === "start") end = start + EVENT_VIDEO_MAX_DURATION_MS;
    else start = end - EVENT_VIDEO_MAX_DURATION_MS;
  }
  return { startMs: start, endMs: end };
}

/**
 * 枠の中身を掴んだ移動 (#425): 長さを保ったまま deltaMs だけずらし、
 * 0〜全長に収める（端に当たったらそこで止まる）。
 */
export function moveVideoTrim(
  trim: VideoTrim,
  deltaMs: number,
  totalMs: number,
): VideoTrim {
  const len = Math.min(trim.endMs - trim.startMs, totalMs);
  const start = Math.min(
    Math.max(0, Math.round(trim.startMs + deltaMs)),
    Math.max(0, totalMs - len),
  );
  return { startMs: start, endMs: start + len };
}

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
  /** トリム (#425)。指定時は「この範囲を切り出して投稿する」前提で判定する。
   * 切り出しは変換（エンコード）でしか実現できないため、変換できない
   * 経路（素通し）には乗せない */
  trim: VideoTrim | null = null,
): VideoPlan {
  if (!probe.hasVideoTrack) {
    return { kind: "reject", reason: "no-video-track" };
  }
  // 長さは demux だけで分かるので、どの経路よりも先に弾く
  const effectiveMs = trim ? trim.endMs - trim.startMs : probe.durationMs;
  if (effectiveMs > EVENT_VIDEO_MAX_DURATION_MS) {
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

  // トリム前提なのに変換経路に乗れなかった → 素通しでは切り出せないので
  // 「長すぎる」として弾く（全長が上限以内ならそもそも trim なしで再判定される）
  if (trim) {
    return { kind: "reject", reason: "too-long" };
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
