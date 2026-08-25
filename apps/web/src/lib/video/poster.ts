import { CanvasSink } from "mediabunny";
import { EVENT_PHOTO_MAX_BYTES } from "@eventer/shared";
import { computeTargetDims, type VideoTrim } from "./plan.js";
import type { ProbedVideo } from "./probe.js";

/**
 * ポスター（サムネイル）1フレームの切り出し (#408)。
 *
 * <video> + seek ではなく mediabunny の CanvasSink を使う。変換と同じ
 * デコード経路なので「変換はできるのにポスターだけ失敗」を避けられる。
 * デコードできない環境（変換もできない環境）では null を返し、
 * ポスターなし（一覧はプレースホルダ表示）を許容する。
 */

/** 写真の encodeImageForUpload と同じ長辺上限に合わせる */
const POSTER_MAX_DIM = 1600;
/** 先頭は真っ黒なことが多いので少し進めた地点を使う */
const POSTER_TIMESTAMP_SEC = 0.5;

/** ポスター画像（WebP、非対応なら JPEG）を切り出す。切り出せなければ null。
 * trim (#425) があるときは選んだ範囲の中から切り出す */
export async function extractVideoPoster(
  probed: ProbedVideo,
  trim: VideoTrim | null = null,
): Promise<Blob | null> {
  try {
    const { input, probe } = probed;
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;

    const dims = computeTargetDims(probe.width, probe.height, POSTER_MAX_DIM);
    const sink = new CanvasSink(track, {
      width: dims.width,
      height: dims.height,
      fit: "contain",
    });

    const baseSec = (trim?.startMs ?? 0) / 1000;
    const durationSec = (trim ? trim.endMs - trim.startMs : probe.durationMs) / 1000;
    const t =
      baseSec + Math.min(POSTER_TIMESTAMP_SEC, Math.max(0, durationSec - 0.01));
    const wrapped = (await sink.getCanvas(t)) ?? (await sink.getCanvas(baseSec));
    if (!wrapped) return null;

    // サーバーの上限（EVENT_PHOTO_MAX_BYTES）は送信前にここで担保する。
    // 超えたまま送ると 40MB の本体を送り切った後に全体が 413 で失敗し、
    // 再送しても同じ結果になる。品質を落として再試行し、それでも
    // 収まらなければポスターなしで送る（プレースホルダ表示になるだけ）
    for (const quality of [0.8, 0.5]) {
      const blob = await canvasToImageBlob(wrapped.canvas, quality);
      if (blob && blob.size <= EVENT_PHOTO_MAX_BYTES) return blob;
    }
    return null;
  } catch {
    return null;
  }
}

async function canvasToImageBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    try {
      return await canvas.convertToBlob({ type: "image/webp", quality });
    } catch {
      return await canvas.convertToBlob({ type: "image/jpeg", quality });
    }
  }
  const el = canvas as HTMLCanvasElement;
  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => el.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp");
  // toBlob は非対応形式だと別形式（PNG）で返すことがあるので型を確かめる
  if (webp && webp.type === "image/webp") return webp;
  return await toBlob("image/jpeg");
}
