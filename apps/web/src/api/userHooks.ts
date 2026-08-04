import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationPrefs,
  UpdateNotificationPrefsInput,
  UserProfile,
} from "@eventer/shared";
import { api } from "./client.js";

/** 通知設定 + メール宛先（連携が無ければ null） (#21 PR3, #126) */
export interface NotificationPrefsData {
  prefs: NotificationPrefs;
  email: string | null;
}

/** 通知設定の取得/更新 (#21 PR3) */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: ["notificationPrefs"],
    queryFn: () => api.get<NotificationPrefsData>("/me/notification-prefs"),
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPrefsInput) =>
      api.put<NotificationPrefsData>("/me/notification-prefs", input),
    onSuccess: (data) => {
      qc.setQueryData(["notificationPrefs"], data);
    },
  });
}

export function useUserProfile(id: string) {
  return useQuery({
    queryKey: ["userProfile", id],
    enabled: Boolean(id),
    queryFn: () => api.get<UserProfile>(`/public/users/${id}`),
  });
}

/** フォロー/フォロー解除（#21） */
export function useSetFollow(handle: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) =>
      on
        ? api.post<{ isFollowing: boolean; followerCount: number }>(
            `/users/${handle}/follow`,
            {},
          )
        : api.del<{ isFollowing: boolean; followerCount: number }>(
            `/users/${handle}/follow`,
          ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["userProfile"] });
      void qc.invalidateQueries({ queryKey: ["myFollowing"] });
    },
  });
}

/** 自分がフォロー中のユーザー（マイページ用・本人のみ） */
export function useMyFollowing() {
  return useQuery({
    queryKey: ["myFollowing"],
    queryFn: async () =>
      (
        await api.get<{
          following: {
            id: string;
            username: string;
            globalName: string | null;
            avatarUrl: string | null;
          }[];
        }>("/me/following")
      ).following,
  });
}

/** 自分のユーザー名（プロフィールURLのハンドル）を変更 */
export function useUpdateUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      api.put<{ ok: boolean; username: string }>("/me/username", { username }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

/** 自分の表示名を変更 (#232) */
export function useUpdateDisplayName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) =>
      api.put<{ ok: boolean; displayName: string }>("/me/display-name", {
        displayName,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
