import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddDateOptionInput,
  FinalizeDateInput,
  ReopenSchedulingInput,
  ScheduleView,
  ScheduleRegistrationResult,
  VoteChoice,
} from "@eventer/shared";
import { api, ApiError } from "./client.js";

export function useEventSchedule(id: string, enabled = true) {
  return useQuery({
    queryKey: ["eventSchedule", id],
    enabled: enabled && Boolean(id),
    queryFn: () => api.get<ScheduleView>(`/events/${id}/schedule`),
  });
}

export function useAddDateOption(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDateOptionInput) =>
      api.post(`/events/${id}/date-options`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["eventSchedule", id] }),
  });
}

export function useDeleteDateOption(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optionId: string) =>
      api.del(`/events/${id}/date-options/${optionId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["eventSchedule", id] }),
  });
}

export function useVoteDateOption(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { optionId: string; choice: VoteChoice }) =>
      api.put(`/events/${id}/date-options/${v.optionId}/vote`, {
        choice: v.choice,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["eventSchedule", id] }),
  });
}

function invalidateSchedule(qc: ReturnType<typeof useQueryClient>, id: string) {
  for (const queryKey of [["event", id], ["eventSchedule", id], ["scheduleRegistration", id], ["events"], ["eventSearch"], ["communityEventSearch"], ["myPage"]]) {
    void qc.invalidateQueries({ queryKey });
  }
}

export function useReopenScheduling(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReopenSchedulingInput) => api.post(`/events/${id}/reopen-scheduling`, input),
    onSuccess: () => invalidateSchedule(qc, id),
    onError: error => { if (error instanceof ApiError && error.status === 409) invalidateSchedule(qc, id); },
  });
}

export function useFinalizeDate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FinalizeDateInput) =>
      api.post<{ results: ScheduleRegistrationResult[] }>(`/events/${id}/finalize-date`, input),
    onError: error => { if (error instanceof ApiError && error.status === 409) invalidateSchedule(qc, id); },
    onSuccess: (data) => {
      qc.setQueryData(["scheduleRegistration", id], { results: data.results });
      invalidateSchedule(qc, id);
    },
  });
}
