import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationPrefs,
  UpdateNotificationPrefsInput,
  UserProfile,
} from "@eventer/shared";
import { api } from "./client.js";

/** 通知設定の取得/更新 (#21 PR3) */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: ["notificationPrefs"],
    queryFn: async () =>
      (await api.get<{ prefs: NotificationPrefs }>("/me/notification-prefs"))
        .prefs,
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPrefsInput) =>
      api.put<{ prefs: NotificationPrefs }>("/me/notification-prefs", input),
    onSuccess: ({ prefs }) => {
      qc.setQueryData(["notificationPrefs"], prefs);
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
