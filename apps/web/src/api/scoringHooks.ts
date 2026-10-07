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
 * できないため、一定間隔で状態（/control では採点進捗も）を再取得する。
 *
 * 回すのはコンテスト形式のイベントだけ・タブが表示中のときだけ（D-POLL-MIN）。
 * コンテスト中、staff が発表・表彰モードに切り替えたのに参加者の画面が付いてこないと、
 * 採点するはずの発表を見逃し、しかも本人は再読み込みが要ることに気づけないため。
 * 非表示の間は止め、表示に戻った瞬間に1回取り直す。
 */
export const EVENT_STREAM_POLL_MS = 10_000;

export function useEventStream(
  eventId: string,
  { contestMode, scoring }: { contestMode: boolean; scoring: boolean },
) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!eventId || !contestMode) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      qc.invalidateQueries({ queryKey: ["event", eventId, "state"] });
      // 採点の進捗・集計は /control（進行コントロール）だけが見る。操作者が
      // 審査員の提出を手を動かさずに追えないと、締めるタイミングが分からないため
      if (scoring) {
        qc.invalidateQueries({ queryKey: ["event", eventId, "progress"] });
        qc.invalidateQueries({ queryKey: ["event", eventId, "summary"] });
      }
    };
    const id = window.setInterval(tick, EVENT_STREAM_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [eventId, contestMode, scoring, qc]);
}
