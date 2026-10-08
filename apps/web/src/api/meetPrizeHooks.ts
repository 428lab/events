import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMeetPrizeInput,
  MeetPrize,
  MeetPrizeList,
  MeetPrizeLogRow,
  MeetPrizeStatus,
  UpdateMeetPrizeInput,
} from "@eventer/shared";
import { ApiError, api } from "./client.js";
import { useEventSignal } from "../lib/signalHub.js";

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
  void qc.invalidateQueries({ queryKey: ["event", eventId, "meet-prize-defs"] });
  void qc.invalidateQueries({ queryKey: ["event", eventId, "meet-prize-log"] });
};

/** 公開の景品一覧（確定メンバーには me 付き）。
 * 定期の取り直しはしない（D-POLL-MIN）。窓口で引き換えた結果は窓口側の応答で分かり、
 * 参加者の画面は開き直し・タブ復帰で取り直す */
export function useMeetPrizes(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "meet-prizes"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<MeetPrizeList>(`/events/${eventId}/meet-prizes`),
    retry: false,
    refetchOnWindowFocus: true,
  });
}

/** 景品の定義一覧（staff・編集画面用）。オフのイベントでも動く軽い口 */
export function useMeetPrizeDefinitions(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "meet-prize-defs"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ prizes: MeetPrize[] }>(`/events/${eventId}/meet-prizes/list`),
  });
}

/** デスク画面（staff のみ）: 景品ごとの達成者と交換状況・確定済みの1位。
 * watch はデスク画面が立てる: 応答の `signal`（topic `prize-desk`）の合図で、この一覧と
 * 引き換え履歴（useMeetPrizeLog）を取り直す（D-POLL-MIN 第5段階 5b-2）。デスクを2台並べると、
 * 片方がもう片方の引き換え済みの景品を渡してしまうため（二重の引き換えはサーバーが 409 で
 * 断るので、操作者を迷わせないためのもの） */
export function useMeetPrizeStatus(
  eventId: string,
  enabled: boolean,
  watch = false,
) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["event", eventId, "meet-prize-status"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<MeetPrizeStatus>(`/events/${eventId}/meet-prizes/status`),
  });
  useEventSignal(watch ? query.data?.signal : null, () => Promise.all([
    query.refetch(),
    qc.invalidateQueries({ queryKey: ["event", eventId, "meet-prize-log"] }),
  ]), { eventId });
  return query;
}

/** 引き換え履歴 (#441)（staff のみ・全景品種別・新しい順）。
 * 自分の操作は invalidate で即時、**他の窓口**の引き換えは useMeetPrizeStatus の合図
 * （topic `prize-desk`）で取り直す（デスクを2台以上並べる運用がある） */
export function useMeetPrizeLog(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "meet-prize-log"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () =>
      api.get<{ log: MeetPrizeLogRow[] }>(`/events/${eventId}/meet-prizes/log`),
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

/** 景品画像のアップロード (#434)。イベント画像 (useUploadEventImage) と同じ
 * 生バイナリ PUT（api.post は JSON 前提なので使わない）。
 * blob は ImageCropField がクロップ・縮小済みのもの */
export function useUploadMeetPrizeImage(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ prizeId, blob }: { prizeId: string; blob: Blob }) => {
      const res = await fetch(
        `/api/events/${eventId}/meet-prizes/${prizeId}/image`,
        {
          method: "PUT",
          headers: { "Content-Type": blob.type },
          credentials: "include",
          body: blob,
        },
      );
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      return res.json();
    },
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** 景品画像の削除 (#434) */
export function useDeleteMeetPrizeImage(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prizeId: string) =>
      api.del(`/events/${eventId}/meet-prizes/${prizeId}/image`),
    onSuccess: () => invalidate(qc, eventId),
  });
}
