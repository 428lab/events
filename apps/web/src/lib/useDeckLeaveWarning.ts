import { useEffect, useRef } from "react";

/** Deck-only warnings; BrowserRouter has no cancellable pop blocker, so Back first lands on a same-URL guard entry. */
export function useDeckLeaveWarning(active: boolean, message: string, removeOnClean = true) {
  const messageRef = useRef(message);
  messageRef.current = message;
  const guard = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      // Drop the extra entry after ACK, but not while import success is replacing this route.
      if (removeOnClean && guard.current && history.state?.__deckLeaveGuard === guard.current) history.back();
      guard.current = null;
      return;
    }
    const token = crypto.randomUUID();
    guard.current = token;
    history.pushState({ ...history.state, __deckLeaveGuard: token }, "", location.href);
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (anchor.href && new URL(anchor.href).pathname !== location.pathname && !window.confirm(messageRef.current)) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    const back = () => {
      if (guard.current !== token) return;
      if (history.state?.__deckLeaveGuard === token) return; // Forward into the guard entry.
      if (window.confirm(messageRef.current)) {
        guard.current = null;
        // A second traversal during the popstate dispatch is ignored by some histories.
        setTimeout(() => history.back(), 0); // Now leave the original entry (or document).
      } else {
        history.pushState({ ...history.state, __deckLeaveGuard: token }, "", location.href);
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", back);
    };
  }, [active, removeOnClean]);
}
