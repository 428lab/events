import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminInquiry,
  CreateEventInquiryInput,
  CreateInquiryInput,
  Inquiry,
  InquiryDetail,
} from "@eventer/shared";
import { api } from "./client.js";

// ===== ユーザー =====
export function useInquiries() {
  return useQuery({
    queryKey: ["inquiries"],
    queryFn: async () =>
      (await api.get<{ inquiries: Inquiry[] }>("/inquiries")).inquiries,
  });
}

export function useInquiryUnreadCount(enabled = true) {
  return useQuery({
    queryKey: ["inquiries", "unread"],
    enabled,
    // 定期の取り直しはしない（D-POLL-MIN）。バッジは数分遅れても困らず、タブ復帰で取り直す
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await api.get<{ count: number }>("/inquiries/unread-count")).count,
  });
}

export function useInquiry(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["inquiry", id],
    queryFn: async () => {
      const d = await api.get<InquiryDetail>(`/inquiries/${id}`);
      qc.invalidateQueries({ queryKey: ["inquiries", "unread"] });
      qc.invalidateQueries({ queryKey: ["inquiries"] });
      return d;
    },
  });
}

export function useCreateInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInquiryInput) =>
      api.post<{ id: string }>("/inquiries", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries"] }),
  });
}

export function usePostInquiryMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post(`/inquiries/${id}/messages`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiry", id] }),
  });
}

// ===== 運営 =====
export function useAdminInquiries() {
  return useQuery({
    queryKey: ["adminInquiries"],
    queryFn: async () =>
      (await api.get<{ inquiries: AdminInquiry[] }>("/admin/inquiries"))
        .inquiries,
  });
}

export function useAdminInquiryUnreadCount(enabled = true) {
  return useQuery({
    queryKey: ["adminInquiries", "unread"],
    enabled,
    // 定期の取り直しはしない（D-POLL-MIN）。バッジは数分遅れても困らず、タブ復帰で取り直す
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await api.get<{ count: number }>("/admin/inquiries/unread-count")).count,
  });
}

export function useAdminInquiry(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["adminInquiry", id],
    queryFn: async () => {
      const d = await api.get<InquiryDetail>(`/admin/inquiries/${id}`);
      qc.invalidateQueries({ queryKey: ["adminInquiries"] });
      return d;
    },
  });
}

export function usePostAdminMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post(`/admin/inquiries/${id}/messages`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminInquiry", id] }),
  });
}

// ===== イベントの主催者あて (D-EVENT-CONTACT) =====
// 定期の取り直しはしない（D-POLL-MIN）。送ったとき・通知を開いたとき・タブに戻ったときに読む

/** 送る側。イベントを見られるログイン中の人なら誰でも送れる（門はサーバー） */
export function useCreateEventInquiry(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInquiryInput) =>
      api.post<{ id: string }>(`/events/${eventId}/inquiries`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inquiries"] }),
  });
}

/** 主催者側（確定スタッフだけ）。enabled はスタッフのときだけ true にする */
export function useEventInquiries(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["eventInquiries", eventId],
    enabled,
    queryFn: async () =>
      (await api.get<{ inquiries: AdminInquiry[] }>(`/events/${eventId}/inquiries`))
        .inquiries,
  });
}

export function useEventInquiryUnreadCount(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["eventInquiries", eventId, "unread"],
    enabled,
    // バッジは数分遅れても困らない。タブ復帰で取り直す
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await api.get<{ count: number }>(`/events/${eventId}/inquiries/unread-count`)).count,
  });
}

export function useEventInquiry(eventId: string, id: string, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["eventInquiry", eventId, id],
    enabled,
    queryFn: async () => {
      const d = await api.get<InquiryDetail>(`/events/${eventId}/inquiries/${id}`);
      // 開くと主催者側の既読が進むので、一覧とバッジを取り直す
      qc.invalidateQueries({ queryKey: ["eventInquiries", eventId] });
      return d;
    },
  });
}

export function usePostEventInquiryMessage(eventId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post(`/events/${eventId}/inquiries/${id}/messages`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eventInquiry", eventId, id] });
      qc.invalidateQueries({ queryKey: ["eventInquiries", eventId] });
    },
  });
}

export function useCloseEventInquiry(eventId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/events/${eventId}/inquiries/${id}/close`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eventInquiry", eventId, id] });
      qc.invalidateQueries({ queryKey: ["eventInquiries", eventId] });
    },
  });
}
