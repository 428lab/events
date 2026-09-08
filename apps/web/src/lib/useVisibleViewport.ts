import { useEffect, useState } from "react";

function readViewport() {
  const viewport = window.visualViewport;
  return {
    height: viewport?.height ?? window.innerHeight,
    width: viewport?.width ?? window.innerWidth,
    top: viewport?.offsetTop ?? 0,
    left: viewport?.offsetLeft ?? 0,
  };
}

/** ソフトウェアキーボードやブラウザのUIで狭まった実表示領域 (#499)。 */
export function useVisibleViewport(enabled: boolean) {
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setViewport(readViewport());
    const visual = window.visualViewport;
    update();
    window.addEventListener("resize", update);
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return viewport;
}
