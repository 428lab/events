import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BingoState, BingoStatus } from "@eventer/shared";
import { BINGO_POLL_MS } from "@eventer/shared";
import { api } from "./client.js";

/**
 * 数字ビンゴ (#436)。
 *
 * - 参加者の状態はゲームが無いイベントに 404 が返る（存在ごと隠す門はサーバー側）。
 *   その間は refetch を止める（useMeetRankingLive と同じ理由）
 * - 抽選コントロール・カード・投影は5秒ポーリング。抽選は staff の mutation 応答で
 *   即時に映り、他の画面は最大5秒遅れで追いつく（読み上げは人間がやるので足りる）
 */

const invalidate = (qc: ReturnType<typeof useQueryClient>, eventId: string) => {
  void qc.invalidateQueries({ queryKey: ["event", eventId, "bingo"] });
  void qc.invalidateQueries({ queryKey: ["event", eventId, "bingo-status"] });
};

/** 参加者向けの状態（自分のカード・判定・人数）。カード画面・投影が使う */
export function useBingoState(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "bingo"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<BingoState>(`/events/${eventId}/bingo`),
    retry: false,
    refetchInterval: (query) => (query.state.error ? false : BINGO_POLL_MS),
  });
}

/** 名前入りの導出一覧（staff のみ。抽選コントロール・デスクが使う） */
export function useBingoStatus(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "bingo-status"],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => api.get<BingoStatus>(`/events/${eventId}/bingo/status`),
    refetchInterval: (query) => (query.state.error ? false : BINGO_POLL_MS),
  });
}

/** カードを受け取る（確定メンバー・冪等） */
export function useIssueBingoCard(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ card: number[] }>(`/events/${eventId}/bingo/card`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

/** staff のゲーム操作。path は create/start/draw/draw/undo/end/reset */
function useBingoOp(eventId: string, path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/events/${eventId}/bingo${path}`),
    onSuccess: () => invalidate(qc, eventId),
  });
}

export const useCreateBingo = (eventId: string) => useBingoOp(eventId, "");
export const useStartBingo = (eventId: string) => useBingoOp(eventId, "/start");
export const useDrawBingo = (eventId: string) => useBingoOp(eventId, "/draw");
export const useUndoBingoDraw = (eventId: string) =>
  useBingoOp(eventId, "/draw/undo");
export const useEndBingo = (eventId: string) => useBingoOp(eventId, "/end");
export const useResetBingo = (eventId: string) => useBingoOp(eventId, "/reset");

export function useDeleteBingo(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/events/${eventId}/bingo`),
    onSuccess: () => invalidate(qc, eventId),
  });
}
