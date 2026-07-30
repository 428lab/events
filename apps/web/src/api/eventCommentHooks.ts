import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventComment } from "@eventer/shared";
import { api } from "./client.js";

export function useEventComments(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "comments"],
    enabled: enabled && Boolean(eventId),
    queryFn: async () =>
      (await api.get<{ comments: EventComment[] }>(`/events/${eventId}/comments`))
        .comments,
  });
}

export function useAddEventComment(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post<{ comment: EventComment }>(`/events/${eventId}/comments`, {
        body,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "comments"] }),
  });
}

export function useDeleteEventComment(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      api.del(`/events/${eventId}/comments/${commentId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "comments"] }),
  });
}
