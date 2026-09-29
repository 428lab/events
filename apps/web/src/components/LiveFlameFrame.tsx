import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLAME_FRAME_LIMITS, LIVE_H, LIVE_W } from "@eventer/shared";
import type { FlamePalette, LiveElement } from "@eventer/shared";
import { FLAME_RAMPS, FLAME_STATIC_TIME, FlameFrameRenderer, drawFlameFrameStill, flameFlowSpeed, flameMargin } from "../lib/flameFrameRenderer.js";
import type { FlameFrameParams } from "../lib/flameFrameRenderer.js";

/** canvas の実画素の上限（1080p の配信ソフトで 1 枚あたりの目安。試作と同じ） */
const MAX_PIXELS = 1.4e6;

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && Boolean(window.matchMedia(reducedMotionQuery)?.matches));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(reducedMotionQuery);
    if (!query?.addEventListener) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 要素の値を範囲に収めて、既定値を埋める */
export function flameFrameSettings(el: LiveElement, lightScene: boolean) {
  const pick = (value: number | undefined, key: keyof typeof FLAME_FRAME_LIMITS) => {
    const limit = FLAME_FRAME_LIMITS[key];
    return Math.min(limit.max, Math.max(limit.min, value ?? limit.default));
  };
  return {
    palette: (el.flamePalette ?? (lightScene ? "gold" : "ember")) as FlamePalette,
    flicker: pick(el.flicker, "flicker"),
    height: pick(el.flameHeight, "flameHeight"),
    thickness: pick(el.frameThickness, "frameThickness"),
    radius: pick(el.radius, "radius"),
    embers: pick(el.embers, "embers"),
  };
}

/**
 * 炎のフレーム (#566)。要素の箱がそのまま枠で、炎は箱の外へ広がる。
 *
 * canvas は 1 枚で、箱の外に炎の余白を足した大きさを負の位置に置く（クリックは素通し）。
 * - animate: 描画ループを 1 本回す（配信画面・編集画面）。一時停止中は止めて今の 1 コマのまま
 * - 動きを減らす設定・animate でないとき（サムネイル）: 決まった時刻の 1 コマだけ
 * - WebGL が使えないとき: 枠の線だけ
 */
export function LiveFlameFrame({ el, lightScene = false, animate = false, paused = false }: { el: LiveElement; lightScene?: boolean; animate?: boolean; paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const [webglFailed, setWebglFailed] = useState(false);
  const settings = flameFrameSettings(el, lightScene);
  const margin = flameMargin(settings.thickness, settings.height * (lightScene ? 0.8 : 1));
  // 画面の外は描かない（回転していると外接矩形が変わるので、そのときは切らない）
  const clip = !el.rotation;
  const left = clip ? Math.max(-margin, -el.x) : -margin;
  const top = clip ? Math.max(-margin, -el.y) : -margin;
  const right = clip ? Math.min(el.w + margin, LIVE_W - el.x) : el.w + margin;
  const bottom = clip ? Math.min(el.h + margin, LIVE_H - el.y) : el.h + margin;
  const cssW = Math.max(1, right - left), cssH = Math.max(1, bottom - top);
  const looping = animate && !paused && !reduced;
  const still = !animate || reduced;

  /** 画面上の実寸から描画解像度を決める（配信画面は拡縮されて表示される） */
  const paramsRef = useRef<() => FlameFrameParams>(() => { throw new Error("unset"); });
  paramsRef.current = () => {
    const canvas = canvasRef.current;
    const shown = canvas?.getBoundingClientRect().width || cssW;
    const dpr = window.devicePixelRatio || 1;
    const perPx = (shown / cssW) * dpr;
    // 画面のほとんどを囲む大きな枠は半分の解像度で描いて拡大する
    const k = el.w * el.h >= LIVE_W * LIVE_H * 0.6 ? 0.5 : 1;
    let bw = cssW * perPx * k, bh = cssH * perPx * k;
    if (bw * bh > MAX_PIXELS) { const f = Math.sqrt(MAX_PIXELS / (bw * bh)); bw *= f; bh *= f; }
    return {
      w: el.w, h: el.h, originX: left, originY: top, cssW, cssH,
      backingW: Math.max(2, Math.round(bw)), backingH: Math.max(2, Math.round(bh)),
      radius: settings.radius, thickness: settings.thickness, height: settings.height,
      flicker: settings.flicker, embers: settings.embers, palette: settings.palette, light: lightScene,
    };
  };

  const rendererRef = useRef<FlameFrameRenderer | null>(null);
  const time = useRef({ clock: 0, flow: 0 });

  // 動かす canvas は自分の WebGL 文脈を 1 つ持つ。外れるときに必ず手放す
  useLayoutEffect(() => {
    if (still) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = FlameFrameRenderer.create(canvas);
    if (!renderer) { setWebglFailed(true); return; }
    setWebglFailed(false);
    rendererRef.current = renderer;
    return () => { rendererRef.current = null; renderer.dispose(); };
  }, [still]);

  // 描画ループ。1 要素につき rAF は 1 本だけ。止まっている間・タブが隠れている間は回さない
  useEffect(() => {
    if (!looping) return;
    let raf = 0, last = 0;
    const frame = (now: number) => {
      raf = 0;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      const params = paramsRef.current();
      time.current.clock += dt;
      time.current.flow += dt * flameFlowSpeed(params.flicker);
      renderer.draw(params, time.current.clock, time.current.flow);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };
    const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start(); };
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => { document.removeEventListener("visibilitychange", onVisibility); cancelAnimationFrame(raf); };
  }, [looping]);

  // 止まっているとき（一時停止・動きを減らす・サムネイル）は、見た目が変わるたびに 1 コマだけ描き直す
  useLayoutEffect(() => {
    if (looping) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = paramsRef.current();
    if (still) {
      const ok = drawFlameFrameStill(canvas, params, FLAME_STATIC_TIME, FLAME_STATIC_TIME * flameFlowSpeed(params.flicker));
      setWebglFailed(!ok);
      return;
    }
    rendererRef.current?.draw(params, time.current.clock, time.current.flow);
  });

  // 画面の大きさが変わったら、止まっていても解像度を合わせて描き直す
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    if (looping) return;
    const onResize = () => setResizeTick(n => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [looping]);

  const lineColor = FLAME_RAMPS[settings.palette][3];
  return (
    <div aria-hidden data-flame-frame={settings.palette} style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "none" }}>
      {webglFailed ? (
        <div data-flame-fallback style={{ position: "absolute", inset: 0, border: `${settings.thickness}px solid ${lineColor}`, borderRadius: Math.min(settings.radius, el.w / 2, el.h / 2), boxSizing: "border-box" }} />
      ) : (
        // 文脈の種類（WebGL か 2D の写し）は一度決めると変えられないので、切り替え時は作り直す
        <canvas key={still ? "still" : "live"} ref={canvasRef} style={{ position: "absolute", left, top, width: cssW, height: cssH, display: "block", pointerEvents: "none" }} />
      )}
    </div>
  );
}
