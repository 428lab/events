import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventAccessInviteList, MyEventAccessList, MyEventInviteList } from "@eventer/shared";
import { api, invalidateEventResponses } from "./client.js";
import { useMe } from "./hooks.js";

// 招待・閲覧権の一覧は定期の取り直しをしない（D-POLL-MIN）。受諾・辞退・招待は本人の操作が
// 無効化する。タブ復帰ではキャッシュが新しくても必ず取り直す（"always"）:
// 取り消された招待・閲覧権の中身を、復帰した画面に残さないため
export function useMyEventInvites() {
  const { data: user } = useMe();
  return useInfiniteQuery({ queryKey: ["eventInvites", user?.id], enabled: Boolean(user), retry: false, refetchOnWindowFocus: "always",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<MyEventInviteList>(`/me/event-invites${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined });
}
export function useMyEventAccess() {
  const { data: user } = useMe();
  return useInfiniteQuery({ queryKey: ["eventAccess", user?.id], enabled: Boolean(user), retry: false, refetchOnWindowFocus: "always",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.get<MyEventAccessList>(`/me/event-access${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined });
}
export function useEventAccessInvites(eventId: string) {
  const { data: user } = useMe();
  return useQuery({ queryKey: ["event", eventId, "accessInvites", user?.id], enabled: Boolean(user), retry: false, refetchOnWindowFocus: "always",
    queryFn: () => api.get<EventAccessInviteList>(`/events/${eventId}/access-invites`) });
}
export function useAccessMutation<T, R = unknown>(mutationFn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn, onSuccess: async () => {
    invalidateEventResponses();
    await qc.cancelQueries({ queryKey: ["event"] });
    qc.removeQueries({ queryKey: ["event"] });
    for (const key of ["community", "communityEventSearch"]) {
      await qc.cancelQueries({ queryKey: [key] });
      void qc.resetQueries({ queryKey: [key] });
    }
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
