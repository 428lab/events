import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BroadcastSegment,
  EventBroadcastsPayload,
  SendBroadcastResult,
} from "@eventer/shared";
import { api } from "./client.js";
import { useEventSignal } from "../lib/signalHub.js";

/** 参加者への一斉連絡 (#172)。送信も履歴もそのイベントのスタッフだけが叩ける */

export function broadcastsQueryKey(eventId: string) {
  return ["event", eventId, "broadcasts"] as const;
}

/** 送信履歴。送信待ちのメールは定期実行が順次送り、そのたびにサーバーから
 * 取り直しの合図（topic `broadcasts`）が届くので、開いたまま眺めていれば
 * 「送信待ち → 送信済み」が動いていく。定期の取り直しはしない（D-POLL-MIN 第5段階 5b-4） */
export function useEventBroadcasts(eventId: string, enabled: boolean) {
  const query = useQuery({
    queryKey: broadcastsQueryKey(eventId),
    enabled: enabled && Boolean(eventId),
    queryFn: () =>
      api.get<EventBroadcastsPayload>(`/events/${eventId}/broadcasts`),
  });
  const { refetch } = query;
  useEventSignal(enabled ? query.data?.signal : null, () => refetch(), { eventId });
  return query;
}

export type { SendBroadcastResult };

export function useSendBroadcast(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      segment: BroadcastSegment;
      title: string;
      body: string;
    }) => api.post<SendBroadcastResult>(`/events/${eventId}/broadcasts`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: broadcastsQueryKey(eventId) }),
  });
}

/** 失敗したメールを送信待ちに戻す（送信回数の上限は消費しない） */
export function useRetryBroadcastEmails(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (broadcastId: string) =>
      api.post<{ requeued: number }>(
        `/events/${eventId}/broadcasts/${broadcastId}/retry-emails`,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: broadcastsQueryKey(eventId) }),
  });
}
