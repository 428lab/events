import { useRef, useState } from "react";
import { AwardConfirmationError } from "../api/awardHooks.js";

type Save = { phase: "pending" | "saved" | "failed" | "unconfirmed"; retry: () => Promise<unknown> };

/** Only the awards editor owns these outstanding writes; no navigation queue. */
export function useAwardEditorSave(onBlockedChange: (blocked: boolean) => void) {
  const current = useRef<Record<string, Save>>({});
  const [saves, setSaves] = useState(current.current);
  const publish = (next: Record<string, Save>) => {
    current.current = next;
    // Synchronous notification covers input blur followed immediately by a ceremony click.
    onBlockedChange(Object.values(next).some((s) => s.phase !== "saved"));
    setSaves(next);
  };
  const run = async (key: string, action: () => Promise<unknown>) => {
    if (current.current[key]?.phase === "pending") return;
    publish({ ...current.current, [key]: { phase: "pending", retry: action } });
    try {
      await action();
      publish({ ...current.current, [key]: { phase: "saved", retry: action } });
    } catch (error) {
      publish({ ...current.current, [key]: {
        phase: error instanceof AwardConfirmationError ? "unconfirmed" : "failed", retry: action,
      } });
    }
  };
  const clear = () => publish({});
  return {
    saves, run, clear,
    busy: Object.values(saves).some((s) => s.phase === "pending"),
    blocked: Object.values(saves).some((s) => s.phase !== "saved"),
    isBusy: () => Object.values(current.current).some((s) => s.phase === "pending"),
  };
}
