import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLiveSetInput,
  LiveSet,
  LiveSetSummary,
  UpdateLiveSetInput,
} from "@eventer/shared";
import { api } from "./client.js";

export function useMyLiveSets() {
  return useQuery({
    queryKey: ["liveSets", "mine"],
    queryFn: async () =>
      (await api.get<{ liveSets: LiveSetSummary[] }>("/live-sets/mine"))
        .liveSets,
  });
}

/** 編集用（owner本人） */
export function useLiveSet(id: string) {
  return useQuery({
    queryKey: ["liveSet", id],
    enabled: Boolean(id),
    queryFn: () => api.get<LiveSet>(`/live-sets/${id}`),
  });
}

export function useCreateLiveSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLiveSetInput) =>
      api.post<LiveSet>("/live-sets", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["liveSets", "mine"] }),
  });
}

export function useUpdateLiveSet(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLiveSetInput) =>
      api.patch<LiveSet>(`/live-sets/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["liveSet", id] });
      qc.invalidateQueries({ queryKey: ["liveSets", "mine"] });
    },
  });
}

export function useUploadLiveSetImage(liveSetId: string) {
  return useMutation({
    mutationFn: async (file: Blob): Promise<{ url: string }> => {
      const res = await fetch(`/api/live-sets/${liveSetId}/images`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        credentials: "include",
        body: file,
      });
      if (!res.ok) throw new Error("upload_failed");
      return res.json();
    },
  });
}

export function useDeleteLiveSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/live-sets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["liveSets", "mine"] }),
  });
}
