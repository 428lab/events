import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BgmTrack } from "@eventer/shared";
import { api } from "./client.js";

export function useBgmTracks() {
  return useQuery({
    queryKey: ["bgmTracks"],
    queryFn: async () => (await api.get<{ tracks: BgmTrack[] }>("/bgm")).tracks,
  });
}

export function useUploadBgm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; name: string; credit: string }) => {
      const form = new FormData();
      form.append("file", input.file);
      form.append("name", input.name);
      form.append("credit", input.credit);
      const res = await fetch("/api/bgm", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error("upload_failed");
      return res.json() as Promise<{ track: BgmTrack }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bgmTracks"] }),
  });
}

export function useDeleteBgm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/bgm/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bgmTracks"] }),
  });
}
