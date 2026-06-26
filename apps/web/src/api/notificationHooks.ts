import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@eventer/shared";
import { api } from "./client.js";

const POLL = 30000;

export function useNotificationUnreadCount(enabled = true) {
  return useQuery({
    queryKey: ["notifications", "unread"],
    enabled,
    refetchInterval: POLL,
    queryFn: async () =>
      (await api.get<{ count: number }>("/notifications/unread-count")).count,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    enabled,
    queryFn: async () =>
      (await api.get<{ notifications: Notification[] }>("/notifications"))
        .notifications,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications", "unread"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/notifications/read-all`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications", "unread"] });
    },
  });
}

/** 受賞者へアプリ内通知を送る（staff、表彰画面から） */
export function useNotifyAwardWinners(eventId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<{ notified: number }>(
        `/events/${eventId}/award-results/notify`,
        {},
      ),
  });
}
