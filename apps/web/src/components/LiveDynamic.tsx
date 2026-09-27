import { useEffect, useRef, useState } from "react";
import type { LiveElement } from "@eventer/shared";
import type { LiveRuntime } from "./LiveStage.js";
import { clockText, countdownSeconds } from "../lib/liveTime.js";
import "./liveDynamic.css";

function useWallTime(seconds: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let monitor: ReturnType<typeof setInterval> | undefined;
    const period = seconds ? 1000 : 60_000;
    const tick = () => { setNow(Date.now()); clearTimeout(timer); timer = setTimeout(tick, period - Date.now() % period); };
    const visible = () => { if (document.visibilityState === "visible") tick(); };
    tick(); document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", tick);
    if (!seconds) {
      let wall = Date.now(), monotonic = performance.now();
      monitor = setInterval(() => {
        const nextWall = Date.now(), nextMono = performance.now();
        if (Math.abs((nextWall - wall) - (nextMono - monotonic)) > 1500) tick();
        wall = nextWall; monotonic = nextMono;
      }, 1000);
    }
    return () => { clearTimeout(timer); if (monitor) clearInterval(monitor); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", tick); };
  }, [seconds]);
  return now;
}
function Marquee({ el, paused }: { el: LiveElement; paused: boolean }) {
  const text = el.text ?? "";
  const measure = useRef<HTMLSpanElement>(null);
  const [repeat, setRepeat] = useState(2);
  useEffect(() => {
    const node = measure.current;
    if (!node) return;
    const calculate = () => setRepeat(Math.min(40, Math.max(2, Math.ceil(el.w / Math.max(node.getBoundingClientRect().width + (el.gap ?? 32), 1)) + 1)));
    const observer = new ResizeObserver(calculate); observer.observe(node); calculate();
    return () => observer.disconnect();
  }, [text, el.w, el.gap]);
  if (!text) return null;
  const strip = Array.from({ length: repeat }, (_, i) => <span key={i} style={{ paddingRight: el.gap ?? 32 }}>{text}</span>);
  return <div className="live-marquee" style={{ color: el.color ?? "#EAF0F7", background: el.fill ?? "#1A2737", fontSize: el.fontSize ?? 19 }}>
    <span ref={measure} className="live-measure">{text}</span>
    <div className="live-marquee-track" style={{ animationDuration: `${el.seconds ?? 20}s`, animationDirection: el.direction === "right" ? "reverse" : "normal", animationPlayState: paused ? "paused" : "running" }}>
      <span className="live-marquee-half">{strip}</span><span aria-hidden className="live-marquee-half">{strip}</span>
    </div>
  </div>;
}
export function LiveDynamic({ el, runtime }: { el: LiveElement; runtime?: LiveRuntime }) {
  const style = { color: el.color ?? "#EAF0F7", background: el.fill ?? "transparent", fontSize: el.fontSize ?? 27, fontFamily: '"Plus Jakarta Sans", "Noto Sans JP", sans-serif' };
  if (el.type === "marquee") return <Marquee el={el} paused={Boolean(runtime?.pauseMotion)} />;
  if (el.type === "liveIndicator") return runtime?.liveIndicatorOn ? <div className="live-indicator" style={style}><span className="live-indicator-dot" />{el.text || "LIVE"}</div> : null;
  return <TimedElement el={el} runtime={runtime} style={style} />;
}
function TimedElement({ el, runtime, style }: { el: LiveElement; runtime?: LiveRuntime; style: React.CSSProperties }) {
  const now = useWallTime(el.type !== "clock" || (el.showSeconds ?? true));
  if (el.type === "clock") {
    const value = clockText(runtime?.previewNow ?? now, el.timezone ?? "Asia/Tokyo", el.showSeconds ?? true, el.showDate ?? false, el.hour12 ?? false);
    return value ? <div className="live-time" style={style}>{value}</div> : null;
  }
  const seconds = countdownSeconds(el.target === "custom" ? el.targetEpochMs : runtime?.eventStartMs, runtime?.previewNow ?? now, el.zero);
  if (seconds === null) return null;
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
  return <div className="live-time" style={style}>{[h, m, s].map(n => String(n).padStart(2, "0")).join(":")}</div>;
}
