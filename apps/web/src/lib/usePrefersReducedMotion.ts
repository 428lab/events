import { useEffect, useState } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/** OS の「視差効果を減らす」設定。立っているときは動き・時間差の演出を出さない
 *  （配信の炎のフレーム・ビンゴの投影の演出が使う） */
export function usePrefersReducedMotion(): boolean {
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
