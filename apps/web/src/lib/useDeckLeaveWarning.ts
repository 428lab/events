import { useEffect } from "react";

/** Deck-only warnings; does not change the application's router or autosave infrastructure. */
export function useDeckLeaveWarning(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (anchor.href && new URL(anchor.href).pathname !== location.pathname && !window.confirm(message)) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    const back = () => window.alert(message);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", back);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); window.removeEventListener("popstate", back); };
  }, [active, message]);
}
