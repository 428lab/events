import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminInquiry,
  CreateInquiryInput,
  Inquiry,
  InquiryDetail,
} from "@eventer/shared";
import { api } from "./client.js";

const POLL = 30000;

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
    refetchInterval: POLL,
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
    refetchInterval: POLL,
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
