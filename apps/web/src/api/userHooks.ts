import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserProfile } from "@eventer/shared";
import { api } from "./client.js";

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
