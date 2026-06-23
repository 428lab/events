import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateCriterionInput,
  EventMode,
  EventState,
  PutScoreInput,
  Score,
  ScoreProgress,
  ScoreSummary,
  ScoringCriterion,
  UpdateCriterionInput,
} from "@eventer/shared";
import { api } from "./client.js";

/** ===== 採点項目 ===== */
export function useCriteria(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "criteria"],
    queryFn: async () =>
      (await api.get<{ criteria: ScoringCriterion[] }>(
        `/events/${eventId}/criteria`,
      )).criteria,
  });
}

export function useCreateCriterion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCriterionInput) =>
      api.post(`/events/${eventId}/criteria`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "criteria"] }),
  });
}

export function useUpdateCriterion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, input }: { cid: string; input: UpdateCriterionInput }) =>
      api.patch(`/events/${eventId}/criteria/${cid}`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "criteria"] }),
  });
}

export function useDeleteCriterion(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cid: string) => api.del(`/events/${eventId}/criteria/${cid}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "criteria"] }),
  });
}

/** ===== 採点 ===== */
export function useMyScores(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "myScores"],
    queryFn: async () =>
      (await api.get<{ scores: Score[] }>(`/events/${eventId}/scores/mine`))
        .scores,
  });
}

export function usePutScore(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutScoreInput) =>
      api.put(`/events/${eventId}/scores`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "myScores"] }),
  });
}

export function useScoreSummary(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "summary"],
    enabled,
    queryFn: () => api.get<ScoreSummary>(`/events/${eventId}/scores/summary`),
  });
}

export type ScoreResults = ScoreSummary & { available: boolean };

/** 公開: 採点結果一覧（締切後/終了後のみ available=true でデータが返る） */
export function useScoreResults(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "results"],
    queryFn: () => api.get<ScoreResults>(`/events/${eventId}/scores/results`),
  });
}

export function useScoreProgress(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "progress"],
    enabled,
    queryFn: () => api.get<ScoreProgress>(`/events/${eventId}/scores/progress`),
  });
}

/** ===== 進行状態 ===== */
export function useEventState(eventId: string, enabled = true) {
  return useQuery({
    queryKey: ["event", eventId, "state"],
    enabled,
    queryFn: () => api.get<EventState>(`/events/${eventId}/state`),
  });
}

export function useSetMode(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: EventMode) =>
      api.patch<EventState>(`/events/${eventId}/state/mode`, { mode }),
    onSuccess: (state) =>
      qc.setQueryData(["event", eventId, "state"], state),
  });
}

export function useSetPresenting(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (presentingEntryId: string | null) =>
      api.patch<EventState>(`/events/${eventId}/state/presenting`, {
        presentingEntryId,
      }),
    onSuccess: (state) =>
      qc.setQueryData(["event", eventId, "state"], state),
  });
}

export function useToggleScoringLock(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<EventState>(`/events/${eventId}/state/scoring-lock`),
    onSuccess: (state) =>
      qc.setQueryData(["event", eventId, "state"], state),
  });
}

/**
 * 進行状態のリアルタイム連動（ポーリング方式）。
 * Cloudflare Workers はステートレス（複数アイソレート）で in-memory SSE 配信が
 * できないため、一定間隔で状態・採点進捗を再取得する。invalidateQueries は
 * アクティブに購読されているクエリのみ再フェッチするので、無駄な通信は出ない。
 */
const POLL_INTERVAL_MS = 2000;

export function useEventStream(eventId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!eventId) return;
    const tick = () => {
      qc.invalidateQueries({ queryKey: ["event", eventId, "state"] });
      qc.invalidateQueries({ queryKey: ["event", eventId, "progress"] });
      qc.invalidateQueries({ queryKey: ["event", eventId, "summary"] });
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [eventId, qc]);
}
