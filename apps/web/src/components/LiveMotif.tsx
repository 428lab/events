import type { LiveElement } from "@eventer/shared";
import { livePalette } from "../lib/livePalette.js";
import "./liveMotif.css";
export function LiveMotif({ el, paused }: { el: LiveElement; paused?: boolean }) {
  const motion = el.motion;
  const cycle = motion?.kind === "colorCycle" && el.w <= 180 && el.h <= 180 ? livePalette(motion.colors, "color") : null;
  const cls = `live-motif live-motif-${el.motif ?? "halo"} ${motion?.kind === "rotation" ? "live-decoration-rotation" : cycle ? "live-decoration-cycle" : ""}`;
  return <><div aria-hidden className={cls} style={{ width: "100%", height: "100%", color: cycle && motion?.kind === "colorCycle" ? motion.colors[0] : el.color ?? "#FB923C", opacity: el.opacity ?? 1, animationName: cycle?.name, animationDuration: motion ? `${motion.seconds}s` : undefined, animationIterationCount: "infinite", animationTimingFunction: "linear", animationDirection: motion?.kind === "rotation" && motion.direction === "counterclockwise" ? "reverse" : "normal", animationPlayState: paused ? "paused" : "running" }}>
    {el.motif === "lantern" ? <><i /><b /><i /></> : el.motif === "brackets" ? <><i /><i /></> : el.motif === "grid" ? null : <><i /><i /></>}
  </div>{cycle && <style>{cycle.css}</style>}</>;
}
