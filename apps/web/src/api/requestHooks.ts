import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateEventRequestInput,
  Event,
  EventRequest,
  EventRequestReaction,
} from "@eventer/shared";
import { api } from "./client.js";

/** イベントのたまご（あったらいいなリクエスト）#29 */

export interface EventRequestsPage {
  requests: EventRequest[];
  total: number;
  limit: number;
}

export interface EventRequestDetail {
  request: EventRequest;
  creator: {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string | null;
  } | null;
  community: { id: string; name: string; slug: string } | null;
  events: Event[];
  myReactions: EventRequestReaction[];
  isMine: boolean;
}

/** 全体のたまご一覧（未ログイン可） */
export function usePublicEventRequests(page: number, status: "open" | "closed" = "open") {
  return useQuery({
    queryKey: ["eventRequests", status, page],
    queryFn: () =>
      api.get<EventRequestsPage>(
        `/public/event-requests?status=${status}&page=${page}`,
      ),
  });
}

/** たまご詳細（未ログイン可） */
export function useEventRequest(id: string) {
  return useQuery({
    queryKey: ["eventRequest", id],
    enabled: Boolean(id),
    retry: false,
    queryFn: () => api.get<EventRequestDetail>(`/public/event-requests/${id}`),
  });
}

export function useCreateEventRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventRequestInput) =>
      api.post<{ request: EventRequest }>("/event-requests", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["eventRequests"] });
    },
  });
}

/** 賛同（参加したい/開催してもいい）のオンオフ */
export function useReactEventRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: EventRequestReaction; on: boolean }) =>
      api.post<{ request: EventRequest; myReactions: EventRequestReaction[] }>(
        `/event-requests/${id}/react`,
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["eventRequest", id] });
      void qc.invalidateQueries({ queryKey: ["eventRequests"] });
    },
  });
}

/** クローズ/再オープン（投稿者） */
export function useSetEventRequestStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: "open" | "closed") =>
      api.post<{ request: EventRequest }>(`/event-requests/${id}/status`, {
        status,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["eventRequest", id] });
      void qc.invalidateQueries({ queryKey: ["eventRequests"] });
    },
  });
}

export function useDeleteEventRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/event-requests/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["eventRequests"] });
    },
  });
}

/** 開催宣言: 作成イベントをたまごに紐付け */
export function useLinkRequestEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, eventId }: { requestId: string; eventId: string }) =>
      api.post<{ ok: boolean }>(`/event-requests/${requestId}/link-event`, {
        eventId,
      }),
    onSuccess: (_d, { requestId }) => {
      void qc.invalidateQueries({ queryKey: ["eventRequest", requestId] });
    },
  });
}
