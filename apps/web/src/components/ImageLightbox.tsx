import { useRef, useState } from "react";
import { Box, Dialog, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
/** ダブルタップ判定（ms / px） */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * チャット画像の拡大表示 (#241)。全画面ダイアログで
 * ピンチ（Pointer Events 2本指）・ホイールズーム（カーソル位置基準）・
 * ドラッグでパン・ダブルタップ/ダブルクリックで等倍⇔2倍を提供する。
 * 依存ライブラリなし。ESC / 右上ボタンで閉じる。
 */
export function ImageLightbox({
  src,
  open,
  onClose,
}: {
  src: string;
  open: boolean;
  onClose: () => void;
}) {
  const [t, setT] = useState<Transform>(IDENTITY);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** アクティブなポインタ（ピンチは2本目まで追跡） */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  /** 直前のピンチ2点間距離（null なら未開始） */
  const pinchDistRef = useRef<number | null>(null);
  /** ダブルタップ検出用の直前タップ */
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  /** 最新の transform（イベントハンドラから同期参照するため） */
  const tRef = useRef(t);
  tRef.current = t;

  /** コンテナ中心を原点にした座標へ変換（transform の基準系と揃える） */
  const toLocal = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : 0;
    const cy = rect ? rect.top + rect.height / 2 : 0;
    return { x: clientX - cx, y: clientY - cy };
  };

  /** 点 p（ローカル座標）を不動点にして倍率を newScale へ変更 */
  const zoomAt = (p: { x: number; y: number }, newScale: number) => {
    const cur = tRef.current;
    const s = clampScale(newScale);
    const k = s / cur.scale;
    setT({
      scale: s,
      x: p.x - (p.x - cur.x) * k,
      y: p.y - (p.y - cur.y) * k,
    });
  };

  const reset = () => {
    setT(IDENTITY);
    pointersRef.current.clear();
    pinchDistRef.current = null;
    lastTapRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchDistRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      lastTapRef.current = null;
      return;
    }
    if (pointersRef.current.size === 1) {
      // ダブルタップ/ダブルクリック: 等倍⇔2倍（タップ位置基準）
      const now = Date.now();
      const prev = lastTapRef.current;
      if (
        prev &&
        now - prev.time < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_DIST
      ) {
        lastTapRef.current = null;
        if (tRef.current.scale !== 1) setT(IDENTITY);
        else zoomAt(toLocal(e.clientX, e.clientY), 2);
      } else {
        lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // ピンチイン/アウト（2点の中点を不動点に）
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const lastDist = pinchDistRef.current;
      pinchDistRef.current = dist;
      if (lastDist && lastDist > 0) {
        const mid = toLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(mid, tRef.current.scale * (dist / lastDist));
      }
      return;
    }
    if (pointers.size === 1) {
      // ドラッグでパン
      const cur = tRef.current;
      setT({
        ...cur,
        x: cur.x + (e.clientX - prev.x),
        y: cur.y + (e.clientY - prev.y),
      });
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchDistRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // ホイール/トラックパッド: カーソル位置基準でズーム
    const factor = Math.exp(-e.deltaY * 0.002);
    zoomAt(toLocal(e.clientX, e.clientY), tRef.current.scale * factor);
  };

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      TransitionProps={{ onExited: reset }}
      slotProps={{ paper: { sx: { bgcolor: "rgba(0, 0, 0, 0.92)" } } }}
    >
      <IconButton
        onClick={onClose}
        aria-label="閉じる"
        sx={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 1,
          color: "#fff",
          bgcolor: "rgba(0, 0, 0, 0.4)",
          "&:hover": { bgcolor: "rgba(0, 0, 0, 0.6)" },
        }}
      >
        <CloseIcon />
      </IconButton>
      <Box
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          // ブラウザ既定のスクロール/ピンチを止めて自前ジェスチャーに割り当てる
          touchAction: "none",
          cursor: t.scale > 1 ? "grab" : "zoom-in",
          userSelect: "none",
        }}
      >
        <Box
          component="img"
          src={src}
          alt=""
          draggable={false}
          sx={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
            transformOrigin: "center center",
            // ドラッグ/ピンチ中の追従を邪魔しないよう transition は付けない
            pointerEvents: "none",
          }}
        />
      </Box>
    </Dialog>
  );
}
