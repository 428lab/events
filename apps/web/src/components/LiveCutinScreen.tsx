import { useEffect, useRef, useState } from "react";
import type { CutinAction, CutinStatus } from "@eventer/shared";
import { useTranslation } from "react-i18next";
import { LiveCutin } from "./LiveCutin.js";

/** The cut-in part of the screen's 1 s live-state poll (D-POLL-MIN S7).
 * `data` is null when the server withholds cut-ins (caller is not confirmed staff). */
export type LiveCutinQuery = { data: CutinStatus | null | undefined; dataUpdatedAt: number; isError: boolean; isFetchedAfterMount: boolean };

/** The tab remembers only its last displayed action ID, never the caption. */
export function LiveCutinScreen({ eventId, query }: { eventId: string; query: LiveCutinQuery }) {
  return <EventCutinScreen key={eventId} eventId={eventId} query={query} />;
}
function EventCutinScreen({ eventId, query }: { eventId: string; query: LiveCutinQuery }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState<CutinAction | null>(null);
  const [storageError, setStorageError] = useState(false);
  const newestResponse = useRef(0);
  const lastUpdate = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  const unavailable = query.isError || !query.isFetchedAfterMount || !query.data || now - query.dataUpdatedAt > 5000;
  useEffect(() => {
    if (unavailable) { setActive(null); return; }
    const status = query.data;
    if (!status || lastUpdate.current === query.dataUpdatedAt || status.serverNow <= newestResponse.current) return;
    lastUpdate.current = query.dataUpdatedAt;
    newestResponse.current = status.serverNow;
    const incoming = status.action;
    if (!incoming || incoming.expiresAt <= Date.now()) { setActive(null); return; }
    try {
      const storageKey = `live-cutin:${eventId}`;
      const seen = sessionStorage.getItem(storageKey);
      if (seen === incoming.actionId) return;
      sessionStorage.setItem(storageKey, incoming.actionId);
      setActive(incoming);
    } catch {
      setStorageError(true);
      setActive(null);
    }
  }, [eventId, query.data, query.dataUpdatedAt, unavailable]);
  if (storageError) return <span role="alert" className="live-cutin-error">{t("studio.cutinStorageError")}</span>;
  if (unavailable || !active || active.expiresAt <= now) return null;
  return <LiveCutin key={active.actionId} action={active} />;
}
