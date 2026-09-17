import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Contest sections can mount after the route's data arrives. */
export function useContestAnchor(id: string, ready = true) {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || hash !== `#${id}`) return;
    const target = document.getElementById(id);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [id, hash, key, ready]);
}
