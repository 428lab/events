import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AwardsView,
  CreateAwardRankInput,
  CreateSpecialAwardInput,
  EventState,
  SetAwardResultInput,
  UpdateAwardRankInput,
  UpdateSpecialAwardInput,
} from "@eventer/shared";
import { api } from "./client.js";

export function useAwards(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "awards"],
    queryFn: () => api.get<AwardsView>(`/events/${eventId}/awards`),
  });
}

export class AwardConfirmationError extends Error {}

const invalidate = async (qc: ReturnType<typeof useQueryClient>, eventId: string) => {
  try {
    await qc.invalidateQueries({ queryKey: ["event", eventId, "awards"] }, { throwOnError: true });
  } catch {
    // The write succeeded: recovery must read, not repeat the write (especially creation).
    throw new AwardConfirmationError("Could not confirm saved awards");
  }
};

export function useCreateRank(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAwardRankInput) =>
      api.post(`/events/${eventId}/award-ranks`, input),
    onSuccess: () => invalidate(qc, eventId),
  });
}
export function useUpdateRank(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rankId, input }: { rankId: string; input: UpdateAwardRankInput }) =>
      api.patch(`/events/${eventId}/award-ranks/${rankId}`, input),
    onSuccess: () => invalidate(qc, eventId),
  });
}
export function useDeleteRank(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rankId: string) =>
      api.del(`/events/${eventId}/award-ranks/${rankId}`),
    onSuccess: () => invalidate(qc, eventId),
  });
}
export function useCreateSpecial(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSpecialAwardInput) =>
      api.post(`/events/${eventId}/special-awards`, input),
    onSuccess: () => invalidate(qc, eventId),
  });
}
export function useUpdateSpecial(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      specialId,
      input,
    }: {
      specialId: string;
      input: UpdateSpecialAwardInput;
    }) => api.patch(`/events/${eventId}/special-awards/${specialId}`, input),
    onSuccess: () => invalidate(qc, eventId),
  });
}
export function useDeleteSpecial(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (specialId: string) =>
      api.del(`/events/${eventId}/special-awards/${specialId}`),
    onSuccess: () => invalidate(qc, eventId),
  });
}
export function useSetAwardResult(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetAwardResultInput) =>
      api.put(`/events/${eventId}/award-results`, input),
    onSuccess: async (_, input) => {
      await invalidate(qc, eventId);
      const awards = qc.getQueryData<AwardsView>(["event", eventId, "awards"]);
      const result = awards?.results.find((r) => input.awardRankId
        ? r.awardRankId === input.awardRankId : r.specialAwardId === input.specialAwardId);
      if ((result?.entryId ?? null) !== input.entryId) {
        throw new AwardConfirmationError("Saved winner did not match");
      }
    },
  });
}

export function useAwardsAdvance(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EventState>(`/events/${eventId}/state/awards-advance`),
    onSuccess: (state) => qc.setQueryData(["event", eventId, "state"], state),
  });
}
export function useAwardsReset(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EventState>(`/events/${eventId}/state/awards-reset`),
    onSuccess: (state) => qc.setQueryData(["event", eventId, "state"], state),
  });
}
