import { CanvasSink } from "mediabunny";
import { computeTargetDims } from "./plan.js";
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

/** ポスター画像（WebP、非対応なら JPEG）を切り出す。切り出せなければ null */
export async function extractVideoPoster(probed: ProbedVideo): Promise<Blob | null> {
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

    const durationSec = probe.durationMs / 1000;
    const t = Math.min(POSTER_TIMESTAMP_SEC, Math.max(0, durationSec - 0.01));
    const wrapped = (await sink.getCanvas(t)) ?? (await sink.getCanvas(0));
    if (!wrapped) return null;

    return await canvasToImageBlob(wrapped.canvas);
  } catch {
    return null;
  }
}

async function canvasToImageBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    try {
      return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
    } catch {
      return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    }
  }
  const el = canvas as HTMLCanvasElement;
  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => el.toBlob(resolve, type, 0.8));
  const webp = await toBlob("image/webp");
  // toBlob は非対応形式だと別形式（PNG）で返すことがあるので型を確かめる
  if (webp && webp.type === "image/webp") return webp;
  return await toBlob("image/jpeg");
}
