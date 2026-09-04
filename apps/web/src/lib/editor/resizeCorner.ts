/**
 * 四隅ハンドルでの変形。
 *
 * react-rnd のリサイズは使わず自前で持っている。要素をつかんで動かす操作と
 * 干渉させないためと、指でも押せる大きさのハンドルを出すため。
 * スライド編集とライブ配信セット編集が同じ式を別々に持っていたので1か所にまとめた。
 */

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** これより小さくはしない。潰すとつかめなくなって戻せない */
export const MIN_SIZE = 20;

export const RESIZE_CORNERS = [
  { corner: "nw", cursor: "nwse-resize" },
  { corner: "ne", cursor: "nesw-resize" },
  { corner: "sw", cursor: "nesw-resize" },
  { corner: "se", cursor: "nwse-resize" },
] as const satisfies readonly { corner: ResizeCorner; cursor: string }[];

/**
 * つかんだ隅と原寸での移動量から、変形後の位置と大きさを出す。
 * 北・西側をつかんだときは反対側の辺を固定したいので、原点も動かす。
 */
export function resizeRect(
  start: Rect,
  corner: ResizeCorner,
  dx: number,
  dy: number,
): Rect {
  let { x, y, w, h } = start;
  if (corner.includes("e")) w = start.w + dx;
  if (corner.includes("w")) w = start.w - dx;
  w = Math.max(MIN_SIZE, w);
  if (corner.includes("w")) x = start.x + (start.w - w);
  if (corner.includes("s")) h = start.h + dy;
  if (corner.includes("n")) h = start.h - dy;
  h = Math.max(MIN_SIZE, h);
  if (corner.includes("n")) y = start.y + (start.h - h);
  return { x, y, w, h };
}

/**
 * ハンドルの大きさ。キャンバスごと scale 倍されるので、
 * 画面上で約24pxに見えるよう逆に補正する。縮小しすぎても押せるよう下限を置く。
 */
export function handleMetrics(scale: number): { size: number; border: number } {
  const s = scale || 1;
  return {
    size: Math.max(12, Math.round(24 / s)),
    border: Math.max(1, Math.round(2 / s)),
  };
}
