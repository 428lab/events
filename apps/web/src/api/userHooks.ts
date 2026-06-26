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

/** 自分のユーザー名（プロフィールURLのハンドル）を変更 */
export function useUpdateUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      api.put<{ ok: boolean; username: string }>("/me/username", { username }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}
