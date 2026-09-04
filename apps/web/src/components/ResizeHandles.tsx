import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  RESIZE_CORNERS,
  handleMetrics,
  resizeRect,
} from "../lib/editor/resizeCorner.js";
import type { Rect, ResizeCorner } from "../lib/editor/resizeCorner.js";

/**
 * 選択中の要素の四隅に出す変形ハンドル。
 *
 * マウスと指を分けずに扱いたいので Pointer Events を使い、押した時点で
 * ポインタを捕まえる（要素の外まで動かしても追従させる）。
 * キャンバスは scale 倍されるため、移動量は原寸へ割り戻してから式に渡す。
 */
export function ResizeHandles({
  rect,
  displayXY,
  scale,
  onStart,
  onResize,
}: {
  /** 変形の基準になる位置と大きさ（原寸） */
  rect: Rect;
  /** つかんで動かしている最中の見た目の位置。ハンドルもそこへ付ける */
  displayXY?: { x: number; y: number };
  scale: number;
  /** つかんだ時。選択をその要素だけに寄せるのに使う */
  onStart?: () => void;
  onResize: (next: Rect) => void;
}) {
  const gesture = useRef<{
    corner: ResizeCorner;
    sx: number;
    sy: number;
    from: Rect;
  } | null>(null);
  const { size, border } = handleMetrics(scale);
  const bx = displayXY?.x ?? rect.x;
  const by = displayXY?.y ?? rect.y;

  const down = (e: ReactPointerEvent, corner: ResizeCorner) => {
    // キャンバス側の「選択解除」やドラッグ開始に伝えない
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onStart?.();
    gesture.current = { corner, sx: e.clientX, sy: e.clientY, from: rect };
  };
  const move = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const s = scale || 1;
    onResize(
      resizeRect(g.from, g.corner, (e.clientX - g.sx) / s, (e.clientY - g.sy) / s),
    );
  };
  const up = () => {
    gesture.current = null;
  };

  return (
    <>
      {RESIZE_CORNERS.map(({ corner, cursor }) => (
        <div
          key={corner}
          onPointerDown={(e) => down(e, corner)}
          onPointerMove={move}
          onPointerUp={up}
          style={{
            position: "absolute",
            left: (corner.includes("w") ? bx : bx + rect.w) - size / 2,
            top: (corner.includes("n") ? by : by + rect.h) - size / 2,
            width: size,
            height: size,
            borderRadius: "50%",
            background: "#2563eb",
            border: `${border}px solid #fff`,
            boxSizing: "border-box",
            cursor,
            touchAction: "none",
            zIndex: 10,
          }}
        />
      ))}
    </>
  );
}
