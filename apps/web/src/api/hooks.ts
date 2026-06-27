import {
  useInfiniteQuery,
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

/** 有効なログインプロバイダ一覧 */
export function useAuthProviders() {
  return useQuery({
    queryKey: ["authProviders"],
    queryFn: async () =>
      (await api.get<{ providers: string[] }>("/auth/providers")).providers,
  });
}

export interface LinkedIdentity {
  provider: string;
  email: string | null;
}

/** ログイン中ユーザーの連携プロバイダ */
export function useIdentities() {
  return useQuery({
    queryKey: ["identities"],
    queryFn: async () =>
      (await api.get<{ identities: LinkedIdentity[] }>("/auth/identities"))
        .identities,
  });
}

export function useUnlinkIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => api.del(`/auth/identities/${provider}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["identities"] }),
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
export function usePublicEvents(page: number, limit?: number) {
  const qs = new URLSearchParams({ page: String(page) });
  if (limit != null) qs.set("limit", String(limit));
  return useQuery({
    queryKey: ["publicEvents", page, limit ?? 12],
    queryFn: () => api.get<PublicEventsPage>(`/public/events?${qs.toString()}`),
  });
}

export interface EventSearchParams {
  q?: string;
  from?: number;
  to?: number;
  after?: number;
  communityId?: string;
  sort?: "soon" | "recent" | "new";
  page?: number;
}

function searchQs(params: EventSearchParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.from != null) qs.set("from", String(params.from));
  if (params.to != null) qs.set("to", String(params.to));
  if (params.after != null) qs.set("after", String(params.after));
  if (params.communityId) qs.set("communityId", params.communityId);
  if (params.sort) qs.set("sort", params.sort);
  return qs;
}

export function useEventSearch(params: EventSearchParams, enabled: boolean) {
  const qs = searchQs(params);
  qs.set("page", String(params.page ?? 1));
  const key = qs.toString();
  return useQuery({
    queryKey: ["eventSearch", key],
    enabled,
    queryFn: () => api.get<PublicEventsPage>(`/public/events/search?${key}`),
  });
}

/** 「続きを見る」用の無限スクロール検索 */
export function useEventSearchInfinite(
  params: EventSearchParams,
  enabled: boolean,
) {
  const base = searchQs(params).toString();
  return useInfiniteQuery({
    queryKey: ["eventSearchInfinite", base],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<PublicEventsPage>(
        `/public/events/search?${base}&page=${pageParam}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}

/** 開催済みの公開イベント（未ログイン可・終了が新しい順・ページング） */
export function usePublicPastEvents(page: number) {
  return useQuery({
    queryKey: ["publicPastEvents", page],
    queryFn: () => api.get<PublicEventsPage>(`/public/events/past?page=${page}`),
  });
}

/** 開催済みの公開イベントを「もっと見る」で遡るための無限読み込み */
export function usePublicPastEventsInfinite(enabled = true) {
  return useInfiniteQuery({
    queryKey: ["publicPastEventsInfinite"],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<PublicEventsPage>(`/public/events/past?page=${pageParam}`),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}

export interface EventCommunityRef {
  id: string;
  slug: string;
  name: string;
  iconUrl: string | null;
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ["event", id],
    queryFn: () =>
      api.get<{
        event: Event;
        myRole: EventRole | null;
        community: EventCommunityRef | null;
      }>(`/events/${id}`),
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

/** 当選操作: 申込者の status を手動設定（staff） */
export function useSetMemberSlotStatus(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slotId,
      userId,
      status,
    }: {
      slotId: string;
      userId: string;
      status: "confirmed" | "waitlist" | "applied" | "lost";
    }) =>
      api.patch(
        `/events/${eventId}/slots/${slotId}/members/${userId}/status`,
        { status },
      ),
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
      qc.invalidateQueries({ queryKey: ["event", id, "slots"] });
      qc.invalidateQueries({ queryKey: ["event", id, "members"] });
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
