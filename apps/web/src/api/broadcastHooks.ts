import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BroadcastSegment,
  EventBroadcastsPayload,
  SendBroadcastResult,
} from "@eventer/shared";
import { api } from "./client.js";

/** 参加者への一斉連絡 (#172)。送信も履歴もそのイベントのスタッフだけが叩ける */

export function broadcastsQueryKey(eventId: string) {
  return ["event", eventId, "broadcasts"] as const;
}

/** 送信待ちが残っている間の再取得間隔。メールは定期実行で順次送られるので、
 * 開いたまま眺めていれば「送信待ち → 送信済み」が動いていくのが分かる。
 * 送信状況はカウンタ列から読むので、1回の再取得で読む行は履歴の件数ぶんだけ */
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
