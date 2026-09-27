import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { verifyEvent } from "nostr-tools/pure";
import { AWARDS_SYNC_KIND, type AwardsSyncConfig } from "@eventer/shared";
import { ChatRelayPool, randomLocalSigner } from "../lib/nostrChat.js";
import { api } from "./client.js";

/** A relay signal only invalidates HTTP data; it never supplies state or results. */
export function useAwardsSync(eventId: string, enabled: boolean) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["event", eventId, "awardsSync"],
    enabled: enabled && Boolean(eventId),
    queryFn: () => api.get<{ sync: AwardsSyncConfig | null }>(`/events/${eventId}/awards-sync`),
  });
  const config = data?.sync;
  useEffect(() => {
    if (!enabled || !config || config.kind !== AWARDS_SYNC_KIND) return;
    const pool = new ChatRelayPool(randomLocalSigner(), config.relays);
    let stopped = false;
    const unsubscribe = pool.subscribe(config.topic, (event) => {
      if (stopped || event.kind !== AWARDS_SYNC_KIND || event.pubkey !== config.pubkey ||
          event.content !== "" || !event.tags.some(tag => tag[0] === "e" && tag[1] === config.topic) ||
          !verifyEvent(event)) return;
      void qc.invalidateQueries({ queryKey: ["event", eventId, "state"] });
      void qc.invalidateQueries({ queryKey: ["event", eventId, "awards"] });
    }, AWARDS_SYNC_KIND, config.pubkey);
    void pool.connect();
    const stop = () => {
      stopped = true;
      unsubscribe();
      pool.close();
    };
    const onAccessReset = (event: Event) => {
      const id = (event as CustomEvent<string | undefined>).detail;
      if (!id || id === eventId) stop();
    };
    window.addEventListener("event-access-reset", onAccessReset);
    return () => {
      window.removeEventListener("event-access-reset", onAccessReset);
      stop();
    };
  }, [enabled, config, eventId, qc]);
}
