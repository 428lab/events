import { useEffect, useRef, useState } from "react";
import type { DeckContent } from "@eventer/shared";
interface Snapshot { title: string; content: DeckContent; revision: number }

/** Deck-only single-flight autosave. Failed snapshots remain queued until explicit retry. */
export function useDeckSave(title: string, content: DeckContent | null, save: (value: { title: string; content: DeckContent }) => Promise<unknown>) {
  const latest = useRef<Snapshot | null>(null);
  const ack = useRef<Snapshot | null>(null);
  const inFlight = useRef(false);
  const failed = useRef(false);
  const mounted = useRef(true);
  const sendFn = useRef(save); sendFn.current = save;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [, render] = useState(0);
  const notify = () => { if (mounted.current) render((n) => n + 1); };
  async function send() {
    if (!latest.current || inFlight.current || failed.current || latest.current === ack.current) return;
    const snapshot = latest.current;
    inFlight.current = true; notify();
    try {
      await sendFn.current({ title: snapshot.title, content: snapshot.content });
      ack.current = snapshot;
    } catch { failed.current = true; }
    finally {
      inFlight.current = false; notify();
      if (mounted.current && !failed.current && latest.current !== ack.current) void send();
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (!content) return;
    if (!latest.current) { latest.current = ack.current = { title, content, revision: 0 }; notify(); return; }
    if (latest.current.title === title && latest.current.content === content) return;
    latest.current = { title, content, revision: latest.current.revision + 1 };
    clearTimeout(timer.current);
    if (!failed.current) timer.current = setTimeout(() => void send(), 800);
    notify();
    return () => clearTimeout(timer.current);
  }, [title, content]);
  const saved = content !== null && ack.current === latest.current && ack.current?.content === content && ack.current.title === title;
  return {
    saved,
    status: failed.current ? "editorFailed" as const : inFlight.current ? "editorSaving" as const : saved ? "editorSaved" as const : "unsaved" as const,
    revision: latest.current?.revision ?? 0, acknowledgedRevision: ack.current?.revision ?? 0,
    retry: () => { failed.current = false; clearTimeout(timer.current); void send(); },
  };
}
