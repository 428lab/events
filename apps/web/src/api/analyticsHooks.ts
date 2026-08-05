import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminStats, EventStats, KpiPayload } from "@eventer/shared";
import { api } from "./client.js";

/** イベントページ表示時にアクセスを記録（マウント毎に1回、document.referrer を送る） */
export function useRecordView(eventId: string, enabled: boolean) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !eventId || sent.current === eventId) return;
    sent.current = eventId;
    // SPA内fetchのRefererは自ドメインになるため、外部流入元は document.referrer を送る。
    // 通知・フィード経由のリンクは ?ref= で明示されるので優先して送る
    const params = new URLSearchParams(window.location.search);
    const refParam = params.get("ref");
    void fetch(`/api/events/${eventId}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        ref: document.referrer,
        ...(refParam ? { refParam } : {}),
      }),
    }).catch(() => {});
    // 記録後は URL から ref を外す（共有時に流入元が伝播しないように）
    if (refParam) {
      params.delete("ref");
      const q = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`,
      );
    }
  }, [eventId, enabled]);
}

export function useEventStats(eventId: string, days: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "stats", days],
    enabled: enabled && Boolean(eventId),
    queryFn: () =>
      api.get<EventStats>(
        `/events/${eventId}/stats${days ? `?days=${days}` : ""}`,
      ),
  });
}

export function useAdminStats(days: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["adminStats", days],
    enabled,
    queryFn: () =>
      api.get<AdminStats>(`/admin/stats${days ? `?days=${days}` : ""}`),
  });
}

/** 運営ダッシュボードのKPI (#257)。app admin のみ。
 * 10本の集計クエリが走るので、フォーカス復帰のたびに叩かないよう staleTime を置く */
export function useAdminKpi(days: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["adminKpi", days],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () =>
      api.get<KpiPayload>(`/admin/kpi${days ? `?days=${days}` : ""}`),
  });
}
