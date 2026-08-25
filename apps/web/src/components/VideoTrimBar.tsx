import { useRef } from "react";
import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  moveVideoTrim,
  normalizeVideoTrim,
  type VideoTrim,
} from "../lib/video/plan.js";

/**
 * 動画トリムの「枠」UI (#425)。iPhone の写真アプリの動画トリムと同じ操作感:
 *
 * - 枠の両端をつまんで伸縮（上限60秒 = EVENT_VIDEO_MAX_DURATION_MS。
 *   超える方向には**伸びない**。エラーは出さず、作れないように倒す）
 * - 枠の中身を掴んで左右にドラッグ（長さを保ったまま範囲ごと移動）
 *
 * 範囲の正規化はすべて lib/video/plan.ts の純関数
 * （normalizeVideoTrim / moveVideoTrim）に寄せ、ここは座標変換だけを持つ。
 * MUI の Slider(range) では「中身を掴んで移動」が素直に作れないため自前実装
 * （Pointer Events。タッチ・マウス共通で、つまみのヒット領域は 28px 確保）。
 * キーボード（←→で1秒）にも対応する。
 */

type DragMode = "start" | "end" | "move";

/** つまみのヒット領域の幅（px）。指で掴めるよう見た目より広く取る */
const HANDLE_HIT_PX = 28;

export function VideoTrimBar({
  totalMs,
  value,
  onChange,
}: {
  totalMs: number;
  value: VideoTrim;
  onChange: (next: VideoTrim) => void;
}) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    origin: VideoTrim;
  } | null>(null);

  /** ドラッグ量（px）→ ミリ秒。ドラッグ開始時点の範囲(origin)からの差分で
   * 計算するので、丸め誤差が蓄積しない */
  const applyDrag = (mode: DragMode, origin: VideoTrim, deltaMs: number) => {
    if (mode === "move") {
      onChange(moveVideoTrim(origin, deltaMs, totalMs));
    } else if (mode === "start") {
      onChange(
        normalizeVideoTrim(origin.startMs + deltaMs, origin.endMs, totalMs, "start"),
      );
    } else {
      onChange(
        normalizeVideoTrim(origin.startMs, origin.endMs + deltaMs, totalMs, "end"),
      );
    }
  };

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, origin: value };
    // capture しておくと、指がバーの外に出てもこの要素に move が届き続ける
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const width = barRef.current?.getBoundingClientRect().width ?? 0;
    if (!drag || width <= 0) return;
    const deltaMs = ((e.clientX - drag.startX) / width) * totalMs;
    applyDrag(drag.mode, drag.origin, deltaMs);
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const keyHandler = (mode: DragMode) => (e: React.KeyboardEvent<HTMLElement>) => {
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    applyDrag(mode, value, dir * 1000);
  };

  const pct = (ms: number) => (totalMs > 0 ? (ms / totalMs) * 100 : 0);
  const dragProps = {
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
  const sec = (ms: number) => Math.round(ms / 1000);

  const handleSx = (side: "start" | "end") => ({
    position: "absolute",
    top: -6,
    bottom: -6,
    [side === "start" ? "left" : "right"]: `-${HANDLE_HIT_PX / 2}px`,
    width: HANDLE_HIT_PX,
    display: "grid",
    placeItems: "center",
    cursor: "ew-resize",
    touchAction: "none",
    // 見た目のつまみ（縦バー）。ヒット領域はこの外側まで広い
    "&::before": {
      content: '""',
      width: 6,
      height: 28,
      borderRadius: 3,
      bgcolor: "primary.main",
    },
  });

  return (
    <Box
      ref={barRef}
      data-testid="trim-bar"
      sx={{
        position: "relative",
        height: 44,
        my: 2,
        mx: `${HANDLE_HIT_PX / 2}px`,
        borderRadius: 1,
        bgcolor: "action.hover",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      {/* 選択範囲の枠。中身を掴むと移動 */}
      <Box
        data-testid="trim-frame"
        role="slider"
        tabIndex={0}
        aria-label={t("eventSocial.videoTrimMove")}
        aria-valuemin={0}
        aria-valuemax={sec(totalMs)}
        aria-valuenow={sec(value.startMs)}
        onPointerDown={beginDrag("move")}
        onKeyDown={keyHandler("move")}
        {...dragProps}
        sx={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${pct(value.startMs)}%`,
          width: `${pct(value.endMs - value.startMs)}%`,
          border: 2,
          borderColor: "primary.main",
          borderRadius: 1,
          bgcolor: "rgba(25,118,210,0.12)",
          cursor: "grab",
          touchAction: "none",
          "&:active": { cursor: "grabbing" },
        }}
      >
        <Box
          data-testid="trim-handle-start"
          role="slider"
          tabIndex={0}
          aria-label={t("eventSocial.videoTrimHandleStart")}
          aria-valuemin={0}
          aria-valuemax={sec(totalMs)}
          aria-valuenow={sec(value.startMs)}
          onPointerDown={beginDrag("start")}
          onKeyDown={keyHandler("start")}
          {...dragProps}
          sx={handleSx("start")}
        />
        <Box
          data-testid="trim-handle-end"
          role="slider"
          tabIndex={0}
          aria-label={t("eventSocial.videoTrimHandleEnd")}
          aria-valuemin={0}
          aria-valuemax={sec(totalMs)}
          aria-valuenow={sec(value.endMs)}
          onPointerDown={beginDrag("end")}
          onKeyDown={keyHandler("end")}
          {...dragProps}
          sx={handleSx("end")}
        />
      </Box>
    </Box>
  );
}
