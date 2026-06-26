import { useQuery } from "@tanstack/react-query";
import type { UserProfile } from "@eventer/shared";
import { api } from "./client.js";

export function useUserProfile(id: string) {
  return useQuery({
    queryKey: ["userProfile", id],
    enabled: Boolean(id),
    queryFn: () => api.get<UserProfile>(`/public/users/${id}`),
  });
}
