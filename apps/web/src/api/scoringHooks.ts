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
import { PARTICIPANT_SIGNAL_JITTER_MS, useEventSignal } from "../lib/signalHub.js";

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

/** 集計（/control）。定期には取り直さず、応答の `signal`（topic `scores`、staff の画面だけが
 * 知る）の合図で集計と進捗（useScoreProgress）を取り直す（D-POLL-MIN 第5段階 5b-3）:
 * 操作者は審査員の提出を手を動かさずに追えないと、締めるタイミングが分からないため */
export function useScoreSummary(eventId: string, enabled: boolean) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["event", eventId, "summary"],
    enabled,
    queryFn: () => api.get<ScoreSummary>(`/events/${eventId}/scores/summary`),
  });
  useEventSignal(enabled ? query.data?.signal : null, () => Promise.all([
    qc.invalidateQueries({ queryKey: ["event", eventId, "summary"] }),
    qc.invalidateQueries({ queryKey: ["event", eventId, "progress"] }),
  ]), { eventId });
  return query;
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

/** 操作の応答で進行状態を直書きする。応答は合図の購読先（`signal`）を含まないので、
 * 直前に取得したものを残す（消すと操作者の画面が購読をやめてしまう） */
export function setEventState(
  qc: ReturnType<typeof useQueryClient>,
  eventId: string,
  state: EventState,
) {
  qc.setQueryData<EventState>(["event", eventId, "state"], (prev) => ({ ...state, signal: prev?.signal }));
}

/** ===== 進行状態 =====
 * 定期には取り直さない。合図の購読は EventLayout の useEventStateSignal が1か所で持つ。
 * タブ復帰では取り直す（D-POLL-MIN 第5段階 D2）: コンテスト中に参加者はアプリを行き来するので、
 * 離れている間に届かなかった合図をここで拾う */
export function useEventState(eventId: string, enabled = true) {
  return useQuery({
    queryKey: ["event", eventId, "state"],
    enabled,
    refetchOnWindowFocus: true,
    queryFn: () => api.get<EventState>(`/events/${eventId}/state`),
  });
}

export function useSetMode(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: EventMode) =>
      api.patch<EventState>(`/events/${eventId}/state/mode`, { mode }),
    onSuccess: (state) => setEventState(qc, eventId, state),
  });
}

export function useSetPresenting(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (presentingEntryId: string | null) =>
      api.patch<EventState>(`/events/${eventId}/state/presenting`, {
        presentingEntryId,
      }),
    onSuccess: (state) => setEventState(qc, eventId, state),
  });
}

export function useToggleScoringLock(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<EventState>(`/events/${eventId}/state/scoring-lock`),
    onSuccess: (state) => setEventState(qc, eventId, state),
  });
}

/**
 * 進行状態の合図（topic `event-state`、D-POLL-MIN 第5段階 5b-3）。モード・発表中・締切・表彰の
 * 段階が変わったら進行状態を1回取り直す（表彰画面は cursor が進むと結果も取り直す）。
 * staff が発表・表彰モードに切り替えたのに参加者の画面が付いてこないと、採点するはずの発表を
 * 見逃すため。購読するのはコンテスト形式のイベントと表彰画面だけ（他のイベントでは進行状態が
 * 変わらないので、リレーにつながない）。
 *
 * 参加者全員が同じ合図で取り直すので、ばらす（`PARTICIPANT_SIGNAL_JITTER_MS`）。表彰画面だけは
 * 1秒以内: 3秒のドラムロールは state の updatedAt から数えるので、5秒ばらすと遅れた人は演出が
 * 消える。1秒なら全員に2秒以上残る */
export const AWARDS_SIGNAL_JITTER_MS = 1_000;

export function useEventStateSignal(
  eventId: string,
  state: EventState | undefined,
  { watch, awards }: { watch: boolean; awards: boolean },
) {
  const qc = useQueryClient();
  useEventSignal(
    watch ? state?.signal : null,
    () => qc.invalidateQueries({ queryKey: ["event", eventId, "state"] }),
    { eventId, jitterMs: awards ? AWARDS_SIGNAL_JITTER_MS : PARTICIPANT_SIGNAL_JITTER_MS },
  );
}
