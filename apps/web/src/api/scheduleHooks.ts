import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddDateOptionInput,
  ScheduleView,
  VoteChoice,
} from "@eventer/shared";
import { api } from "./client.js";

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

export function useFinalizeDate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optionId: string) =>
      api.post(`/events/${id}/finalize-date`, { optionId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", id] });
      qc.invalidateQueries({ queryKey: ["eventSchedule", id] });
    },
  });
}
