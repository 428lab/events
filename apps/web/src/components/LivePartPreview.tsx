import { FLAME_FRAME_LIMITS, LIVE_H, LIVE_W } from "@eventer/shared";
import type { LiveElement } from "@eventer/shared";
import { flameMargin } from "../lib/flameFrameRenderer.js";
import { LiveElementContent } from "./LiveStage.js";
import type { LiveRuntime } from "./LiveStage.js";

/** 見本の時刻と開始時刻。時刻・開始カウントが空にならないよう固定値を入れる（編集画面の見本時刻と同じ） */
const SAMPLE_NOW = Date.UTC(2026, 8, 27, 10, 4, 8);
const SAMPLE_EVENT_START = SAMPLE_NOW + (1 * 3600 + 23 * 60 + 45) * 1000;

/** 要素の外側に取る余白（原寸 px）。枠いっぱいに詰めると窮屈に見える */
const PAD = 16;

/** 要素が描く範囲。炎は箱の外へ広がるので、その分を足して画面の内側に収める */
function drawnBox(el: LiveElement) {
  if (el.type !== "motif" || el.motif !== "flameFrame") return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
  const margin = flameMargin(el.frameThickness ?? FLAME_FRAME_LIMITS.frameThickness.default, el.flameHeight ?? FLAME_FRAME_LIMITS.flameHeight.default);
  return { x0: Math.max(0, el.x - margin), y0: Math.max(0, el.y - margin), x1: Math.min(LIVE_W, el.x + el.w + margin), y1: Math.min(LIVE_H, el.y + el.h + margin) };
}

/**
 * 「パーツを追加」の見本 (#566)。置く予定の要素を、開いているシーンの背景の上に
 * 枠いっぱいへ拡大して描く。中身は配信画面と同じ LiveElementContent。
 *
 * - animate なし（一覧のサムネイル）: 動きは止め、炎は止めた 1 コマ（WebGL の描画ループを持たない）
 * - animate あり（設定欄の大きな見本）: 流れる案内・回転・炎を実際に動かして、選んだ値の効き方を見せる
 */
export function LivePartPreview({
  elements,
  background,
  lightScene,
  width,
  height,
  animate = false,
}: {
  elements: LiveElement[];
  background: string;
  lightScene: boolean;
  width: number;
  height: number;
  animate?: boolean;
}) {
  const boxes = elements.map(drawnBox);
  const x0 = Math.min(...boxes.map(b => b.x0)) - PAD, y0 = Math.min(...boxes.map(b => b.y0)) - PAD;
  const x1 = Math.max(...boxes.map(b => b.x1)) + PAD, y1 = Math.max(...boxes.map(b => b.y1)) + PAD;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  // 小さな飾りを拡大しすぎると線が太って別物に見えるので、2 倍までにとどめる
  const scale = Math.min(width / bw, height / bh, 2);
  const runtime: LiveRuntime = { liveIndicatorOn: true, previewNow: SAMPLE_NOW, eventStartMs: SAMPLE_EVENT_START, pauseMotion: !animate };
  return (
    <div aria-hidden style={{ width, height, position: "relative", overflow: "hidden", background: background || "#0E1426", pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: (width - bw * scale) / 2, top: (height - bh * scale) / 2, width: bw, height: bh, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {elements.map(el => (
          <div key={el.id} style={{ position: "absolute", left: el.x - x0, top: el.y - y0, width: el.w, height: el.h, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}>
            {/* 炎は runtime を渡すと描画ループを回す。サムネイルでは渡さず止めた 1 コマにする */}
            <LiveElementContent el={el} runtime={el.motif === "flameFrame" && !animate ? undefined : runtime} lightScene={lightScene} />
          </div>
        ))}
      </div>
    </div>
  );
}
