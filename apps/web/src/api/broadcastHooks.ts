import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BroadcastSegment,
  EventBroadcastsPayload,
} from "@eventer/shared";
import { api } from "./client.js";

/** 参加者への一斉連絡 (#172)。送信も履歴もそのイベントのスタッフだけが叩ける */

export function broadcastsQueryKey(eventId: string) {
  return ["event", eventId, "broadcasts"] as const;
}

/** 送信待ちが残っている間の再取得間隔。メールは定期実行で順次送られるので、
 * 開いたまま眺めていれば「送信待ち → 送信済み」が動いていくのが分かる */
const BROADCAST_POLL_MS = 15000;

export function useEventBroadcasts(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: broadcastsQueryKey(eventId),
    enabled: enabled && Boolean(eventId),
    queryFn: () =>
      api.get<EventBroadcastsPayload>(`/events/${eventId}/broadcasts`),
    refetchInterval: (query) =>
      query.state.data?.broadcasts.some((b) => b.email.pending > 0)
        ? BROADCAST_POLL_MS
        : false,
  });
}

export interface SendBroadcastResult {
  id: string;
  recipientCount: number;
  emailQueued: number;
}

export function useSendBroadcast(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      segment: BroadcastSegment;
      title: string;
      body: string;
    }) =>
      api.post<SendBroadcastResult>(`/events/${eventId}/broadcasts`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: broadcastsQueryKey(eventId) }),
  });
}
