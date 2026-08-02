import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventLikesSummary, SetEventLikeInput } from "@eventer/shared";
import { api } from "./client.js";

/** いいね集計の取得（参加確定メンバーのみ叩く。それ以外は enabled=false にすること） */
export function useEventLikes(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "likes"],
    enabled: enabled && Boolean(eventId),
    queryFn: async () =>
      (await api.get<{ summary: EventLikesSummary }>(`/events/${eventId}/likes`))
        .summary,
  });
}

/** いいねのON/OFF切替。レスポンスの最新集計でキャッシュを即時更新する */
export function useSetEventLike(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetEventLikeInput) =>
      api.put<{ summary: EventLikesSummary }>(`/events/${eventId}/likes`, input),
    onSuccess: (data) => {
      qc.setQueryData(["event", eventId, "likes"], data.summary);
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: ["event", eventId, "likes"] });
    },
  });
}
