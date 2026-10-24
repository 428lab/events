import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateTeamInput, Entry, UpdateTeamInput } from "@eventer/shared";
import { api } from "./client.js";

/** コンテストのチーム参加 (#9, docs/team-participation.md)。
 * どの操作も応答に最新のエントリー一覧を返すので、そのままキャッシュへ入れる */
export function useTeamAction<T>(eventId: string, call: (input: T) => Promise<{ entries: Entry[] }>, alsoEvent = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (res) => {
      qc.setQueryData(["event", eventId, "entries"], res.entries);
      if (alsoEvent) qc.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export const teamApi = (eventId: string) => ({
  setMode: (enabled: boolean) => api.put<{ entries: Entry[] }>(`/events/${eventId}/team-mode`, { enabled }),
  create: (input: CreateTeamInput) => api.post<{ id: string; entries: Entry[] }>(`/events/${eventId}/teams`, input),
  update: ({ teamId, input }: { teamId: string; input: UpdateTeamInput }) =>
    api.patch<{ entries: Entry[] }>(`/events/${eventId}/teams/${teamId}`, input),
  remove: (teamId: string) => api.del<{ entries: Entry[] }>(`/events/${eventId}/teams/${teamId}`),
  setLeader: ({ teamId, userId }: { teamId: string; userId: string | null }) =>
    api.put<{ entries: Entry[] }>(`/events/${eventId}/teams/${teamId}/leader`, { userId }),
  assign: ({ userId, teamId }: { userId: string; teamId: string | null }) =>
    api.put<{ entries: Entry[] }>(`/events/${eventId}/team-members/${userId}`, { teamId }),
  join: (teamId: string) => api.post<{ entries: Entry[] }>(`/events/${eventId}/teams/${teamId}/join`),
  leave: () => api.del<{ entries: Entry[] }>(`/events/${eventId}/my-team`),
});
