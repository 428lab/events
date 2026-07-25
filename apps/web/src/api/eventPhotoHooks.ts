import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventPhoto } from "@eventer/shared";
import { api } from "./client.js";

export function useEventPhotos(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "photos"],
    enabled: enabled && Boolean(eventId),
    queryFn: async () =>
      (await api.get<{ photos: EventPhoto[] }>(`/events/${eventId}/photos`))
        .photos,
  });
}

export function useUploadEventPhoto(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const res = await fetch(`/api/events/${eventId}/photos`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "image/webp" },
        credentials: "include",
        body: blob,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "upload_failed");
      }
      return res.json() as Promise<{ photo: EventPhoto }>;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "photos"] }),
  });
}

export function useDeleteEventPhoto(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      api.del(`/events/${eventId}/photos/${photoId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["event", eventId, "photos"] }),
  });
}
