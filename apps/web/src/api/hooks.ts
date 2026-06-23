import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateEventInput,
  Entry,
  Event,
  EventMemberWithUser,
  EventRole,
  CreateSlotInput,
  MyPage,
  ParticipationSlot,
  Submission,
  UpdateEventInput,
  UpdateSlotInput,
  UpdateSubmissionInput,
  User,
} from "@eventer/shared";
import { api, ApiError } from "./client.js";

interface MeResponse {
  user: User;
  isAdmin: boolean;
}

async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>("/auth/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

/** ログインユーザー（未ログインなら null）。data は User を返す（従来互換） */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    select: (d) => d?.user ?? null,
  });
}

/** アプリ運営管理者かどうか */
export function useIsAdmin(): boolean {
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    select: (d) => d?.isAdmin ?? false,
  });
  return data ?? false;
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDevLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ user: User }>("/auth/dev-login"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useMyPage() {
  return useQuery({
    queryKey: ["myPage"],
    queryFn: () => api.get<MyPage>("/me/events"),
  });
}

export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: async () => (await api.get<{ events: Event[] }>("/events")).events,
  });
}

export interface PublicEventsPage {
  events: Event[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** 開催前の公開イベント（未ログイン可・開催直前順・ページング） */
export function usePublicEvents(page: number) {
  return useQuery({
    queryKey: ["publicEvents", page],
    queryFn: () => api.get<PublicEventsPage>(`/public/events?page=${page}`),
  });
}

/** 開催済みの公開イベント（未ログイン可・終了が新しい順・ページング） */
export function usePublicPastEvents(page: number) {
  return useQuery({
    queryKey: ["publicPastEvents", page],
    queryFn: () => api.get<PublicEventsPage>(`/public/events/past?page=${page}`),
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ["event", id],
    queryFn: () =>
      api.get<{ event: Event; myRole: EventRole | null }>(`/events/${id}`),
  });
}

export function useEventMembers(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", id, "members"],
    enabled,
    queryFn: async () =>
      (await api.get<{ members: EventMemberWithUser[] }>(`/events/${id}/members`))
        .members,
  });
}

export function useEventEntries(id: string) {
  return useQuery({
    queryKey: ["event", id, "entries"],
    queryFn: async () =>
      (await api.get<{ entries: Entry[] }>(`/events/${id}/entries`)).entries,
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      api.post<{ event: Event }>("/events", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["myPage"] });
    },
  });
}

export function useUpdateEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEventInput) =>
      api.patch<{ event: Event }>(`/events/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", id] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["myPage"] });
    },
  });
}

export function useDeleteEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["myPage"] });
    },
  });
}

export function usePublishEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ event: Event }>(`/events/${id}/publish`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["event", id] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useJoinEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, slotId }: { id: string; slotId?: string | null }) =>
      api.post(`/events/${id}/join`, { slotId: slotId ?? null }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ["event", id] });
      qc.invalidateQueries({ queryKey: ["myPage"] });
    },
  });
}

/** ===== 参加枠 ===== */
export function useEventSlots(eventId: string) {
  return useQuery({
    queryKey: ["event", eventId, "slots"],
    queryFn: async () =>
      (await api.get<{ slots: ParticipationSlot[] }>(`/events/${eventId}/slots`))
        .slots,
  });
}

export function useCreateSlot(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSlotInput) =>
      api.post(`/events/${eventId}/slots`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "slots"] }),
  });
}

export function useUpdateSlot(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slotId, input }: { slotId: string; input: UpdateSlotInput }) =>
      api.patch(`/events/${eventId}/slots/${slotId}`, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "slots"] }),
  });
}

export function useDeleteSlot(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) =>
      api.del(`/events/${eventId}/slots/${slotId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "slots"] }),
  });
}

export function useDrawSlot(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) =>
      api.post(`/events/${eventId}/slots/${slotId}/draw`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId, "slots"] });
      qc.invalidateQueries({ queryKey: ["event", eventId, "members"] });
      qc.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export function useLeaveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/events/${id}/join`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["event", id] });
      qc.invalidateQueries({ queryKey: ["myPage"] });
    },
  });
}

export function eventImageUrl(event: {
  id: string;
  imageUpdatedAt: number | null;
}): string | null {
  if (!event.imageUpdatedAt) return null;
  return `/api/events/${event.id}/image?v=${event.imageUpdatedAt}`;
}

export function useUploadEventImage(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const res = await fetch(`/api/events/${eventId}/image`, {
        method: "PUT",
        headers: { "Content-Type": blob.type },
        credentials: "include",
        body: blob,
      });
      if (!res.ok) throw new ApiError(res.status, await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["myPage"] });
    },
  });
}

export function useDeleteEventImage(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/events/${eventId}/image`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["myPage"] });
    },
  });
}

export function useUpdateSubmission(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entryId,
      input,
    }: {
      entryId: string;
      input: UpdateSubmissionInput;
    }) =>
      api.put<{ submission: Submission }>(
        `/events/${eventId}/entries/${entryId}/submission`,
        input,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "entries"] }),
  });
}
