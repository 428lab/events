import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMeetPrizeInput,
  MeetPrizeList,
  MeetPrizeStatus,
  UpdateMeetPrizeInput,
} from "@eventer/shared";
import { MEET_RANKING_POLL_MS } from "@eventer/shared";
import { api } from "./client.js";

/**
 * 出会いの景品引き換え (#431)。
 *
 * - 公開一覧はオフのイベントに 404 が返る（存在ごと隠す門はサーバー側）。
 *   その間は refetch を止める（useMeetRankingLive と同じ理由）
 * - デスク（staff）は引き換えの窓口で使うので、ランキングと同じ5秒間隔で
 *   取り直す（窓口でQRを読み合った直後の達成が出るように）
 */

const invalidate = (qc: ReturnType<typeof useQueryClient>, eventId: string) => {
  void qc.invalidateQueries({ queryKey: ["event", eventId, "meet-prizes"] });
  void qc.invalidateQueries({
    queryKey: ["event", eventId, "meet-prize-status"],
  });
};

/** 公開の景品一覧（確定メンバーには me 付き） */
export function useMeetPrizes(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "meet-prizes"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<MeetPrizeList>(`/events/${eventId}/meet-prizes`),
    retry: false,
  });
}

/** デスク画面（staff のみ）: 景品ごとの達成者と交換状況・確定済みの1位 */
export function useMeetPrizeStatus(
  eventId: string,
  enabled: boolean,
  poll = false,
) {
  return useQuery({
    queryKey: ["event", eventId, "meet-prize-status"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<MeetPrizeStatus>(`/events/${eventId}/meet-prizes/status`),
    refetchInterval: (query) =>
      poll && !query.state.error ? MEET_RANKING_POLL_MS : false,
  });
}

export function useCreateMeetPrize(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMeetPrizeInput) =>
      api.post(`/events/${eventId}/meet-prizes`, input),
    onSuccess: () => invalidate(qc, eventId),
  });
}

export function useUpdateMeetPrize(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      prizeId,
      input,
    }: {
      prizeId: string;
      input: UpdateMeetPrizeInput;
    }) => api.patch(`/events/${eventId}/meet-prizes/${prizeId}`, input),
    onSuccess: () => invalidate(qc, eventId),
  });
}

export function useDeleteMeetPrize(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prizeId: string) =>
      api.del(`/events/${eventId}/meet-prizes/${prizeId}`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** 交換済みにする（staff）。409 の error コードは窓口の案内文言に使う */
export function useRedeemMeetPrize(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prizeId, userId }: { prizeId: string; userId: string }) =>
      api.post(`/events/${eventId}/meet-prizes/${prizeId}/redeem`, { userId }),
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** 交換済みの取り消し（staff・誤操作訂正） */
export function useUnredeemMeetPrize(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prizeId, userId }: { prizeId: string; userId: string }) =>
      api.del(`/events/${eventId}/meet-prizes/${prizeId}/redeem/${userId}`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** 1位を確定する（staff）。締め直しも同じ口（全置換） */
export function useCloseMeetWinners(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/events/${eventId}/meets/winners/close`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** 確定を取り消して未確定に戻す（staff） */
export function useClearMeetWinners(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/events/${eventId}/meets/winners`),
    onSuccess: () => invalidate(qc, eventId),
  });
}
