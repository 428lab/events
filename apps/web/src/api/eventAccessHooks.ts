import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventAccessInviteList, MyEventAccessList, MyEventInviteList } from "@eventer/shared";
import { api, invalidateEventResponses } from "./client.js";
import { useMe } from "./hooks.js";

export function useMyEventInvites() {
  const { data: user } = useMe();
  return useInfiniteQuery({ queryKey: ["eventInvites", user?.id], enabled: Boolean(user), retry: false, refetchOnWindowFocus: "always",
    initialPageParam: undefined as string | undefined, refetchInterval: 15_000,
    queryFn: ({ pageParam }) => api.get<MyEventInviteList>(`/me/event-invites${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined });
}
export function useMyEventAccess() {
  const { data: user } = useMe();
  return useInfiniteQuery({ queryKey: ["eventAccess", user?.id], enabled: Boolean(user), retry: false, refetchOnWindowFocus: "always",
    initialPageParam: undefined as string | undefined, refetchInterval: 15_000,
    queryFn: ({ pageParam }) => api.get<MyEventAccessList>(`/me/event-access${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined });
}
export function useEventAccessInvites(eventId: string) {
  const { data: user } = useMe();
  return useQuery({ queryKey: ["event", eventId, "accessInvites", user?.id], enabled: Boolean(user), retry: false, refetchOnWindowFocus: "always",
    refetchInterval: 15_000, queryFn: () => api.get<EventAccessInviteList>(`/events/${eventId}/access-invites`) });
}
export function useAccessMutation<T, R = unknown>(mutationFn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: async () => {
    invalidateEventResponses();
    await qc.cancelQueries({ queryKey: ["event"] });
    qc.removeQueries({ queryKey: ["event"] });
    // Do not wait for the list refetch to unmount the responding card before
    // its successful-accept navigation callback runs.
    for (const key of ["eventInvites", "eventAccess", "myPage", "notifications"]) void qc.invalidateQueries({ queryKey: [key] });
  } });
}
/** Exact existing profile endpoint; never a general user-search API. */
export interface AccessRecipient { id: string; handle: string; name: string }
export async function previewAccessRecipient(handle: string): Promise<AccessRecipient> {
  const profile = await api.get<AccessRecipient>(`/public/users/${encodeURIComponent(handle.replace(/^@/, ""))}`);
  return profile;
}
