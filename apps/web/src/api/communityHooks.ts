import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Community,
  CommunityDetail,
  CommunityMember,
  CreateCommunityInput,
} from "@eventer/shared";
import { api } from "./client.js";

export function useCommunities() {
  return useQuery({
    queryKey: ["communities"],
    queryFn: async () =>
      (await api.get<{ communities: Community[] }>("/public/communities"))
        .communities,
  });
}

export function useCommunity(slug: string) {
  return useQuery({
    queryKey: ["community", slug],
    enabled: Boolean(slug),
    queryFn: () => api.get<CommunityDetail>(`/public/communities/${slug}`),
  });
}

export function useCommunityMembers(slug: string) {
  return useQuery({
    queryKey: ["community", slug, "members"],
    enabled: Boolean(slug),
    queryFn: async () =>
      (
        await api.get<{ members: CommunityMember[] }>(
          `/public/communities/${slug}/members`,
        )
      ).members,
  });
}

/** イベント紐付け候補：自分がオーナー/運営のコミュニティ */
export function useMyCommunities(enabled = true) {
  return useQuery({
    queryKey: ["communities", "mine"],
    enabled,
    queryFn: async () =>
      (await api.get<{ communities: Community[] }>("/communities/mine"))
        .communities,
  });
}

export function useCreateCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommunityInput) =>
      api.post<Community>("/communities", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["communities"] }),
  });
}

export function useJoinCommunity(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: string) =>
      api.post(`/communities/${communityId}/membership`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community", slug] });
      qc.invalidateQueries({ queryKey: ["community", slug, "members"] });
    },
  });
}

export function useLeaveCommunity(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (communityId: string) =>
      api.del(`/communities/${communityId}/membership`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community", slug] });
      qc.invalidateQueries({ queryKey: ["community", slug, "members"] });
    },
  });
}
