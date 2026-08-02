import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateEventInput,
  Entry,
  Event,
  EventMemberWithUser,
  EventRequest,
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

export interface PublicEventsPage {
  events: Event[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface EventSearchParams {
  q?: string;
  from?: number;
  to?: number;
  after?: number;
  communityId?: string;
  sort?: "soon" | "recent" | "new";
  page?: number;
  /** 1ページ件数（サーバ既定12・最大50） */
  limit?: number;
  phase?: "upcoming" | "past";
}

function searchQs(params: EventSearchParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.from != null) qs.set("from", String(params.from));
  if (params.to != null) qs.set("to", String(params.to));
  if (params.after != null) qs.set("after", String(params.after));
  if (params.communityId) qs.set("communityId", params.communityId);
  if (params.sort) qs.set("sort", params.sort);
  if (params.phase) qs.set("phase", params.phase);
  if (params.limit != null) qs.set("limit", String(params.limit));
  return qs;
}

export function useEventSearch(params: EventSearchParams, enabled: boolean) {
  const qs = searchQs(params);
  qs.set("page", String(params.page ?? 1));
  const key = qs.toString();
  return useQuery({
    queryKey: ["eventSearch", key],
    enabled,
    // ページ送りや絞り込み変更時に前の結果を表示したまま更新（ちらつき防止）
    placeholderData: keepPreviousData,
    queryFn: () => api.get<PublicEventsPage>(`/public/events/search?${key}`),
  });
}

/** 短いシェアURL（/e/:slug）→ イベントIDの解決 */
export function useEventBySlug(slug: string) {
  return useQuery({
    queryKey: ["eventBySlug", slug],
    enabled: Boolean(slug),
    retry: false,
    queryFn: () => api.get<{ id: string }>(`/public/events/by-slug/${slug}`),
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
        /** 参加者限定の文章。確定メンバー・staff・作成者・管理者にのみ返る */
        membersNote?: string;
        myRole: EventRole | null;
        community: EventCommunityRef | null;
        /** 生まれ元のたまご（あったらいいな）。通常は0〜1件（旧レスポンスでは欠落しうる） */
        fromRequests?: EventRequest[];
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

/** イベントを複製して下書きイベントを作る（staff のみ） */
export function useDuplicateEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ event: Event }>(`/events/${id}/duplicate`),
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

/** イベントメンバーのロール変更（staff） */
export function useSetEventMemberRole(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; role: EventRole }) =>
      api.patch(`/events/${eventId}/members/${v.userId}/role`, { role: v.role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId, "members"] });
      qc.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

/** 出席チェック（staff）。楽観更新はせずメンバー一覧を再取得 */
export function useSetAttendance(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; attended: boolean }) =>
      api.patch(`/events/${eventId}/members/${v.userId}/attendance`, {
        attended: v.attended,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId, "members"] });
      qc.invalidateQueries({ queryKey: ["event", eventId] });
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
