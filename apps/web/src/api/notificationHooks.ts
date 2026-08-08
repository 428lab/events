import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationsPayload } from "@eventer/shared";
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

/** お知らせのページ (#294)。既読・全既読の後は ["notifications"] の無効化で
 * どのページも取り直される（キーの先頭を揃えてあるため） */
export function useNotificationPage(page: number, enabled = true) {
  return useQuery({
    queryKey: ["notifications", "list", page],
    enabled,
    queryFn: () =>
      api.get<NotificationsPayload>(`/notifications?page=${page}`),
  });
}

/** 通知ベル用。新しいものだけ見えれば足りるので1ページ目を使う */
export function useNotifications(enabled = true) {
  const query = useNotificationPage(1, enabled);
  return { ...query, data: query.data?.notifications };
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
