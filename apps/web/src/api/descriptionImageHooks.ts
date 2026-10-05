import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventDescriptionImage } from "@eventer/shared";
import { api, ApiError } from "./client.js";

/** 説明文・参加者限定文章に差し込む画像 (D-DESC-IMAGE)。編集画面だけで使う */
const key = (eventId: string) => ["eventDescriptionImages", eventId] as const;

export function useEventDescriptionImages(eventId: string) {
  return useQuery({
    queryKey: key(eventId),
    queryFn: async () =>
      (await api.get<{ images: EventDescriptionImage[] }>(`/events/${eventId}/description-images`)).images,
    enabled: !!eventId,
  });
}

/** 生バイナリで送る（api.post は JSON 前提なので使わない）。blob は縮小済み */
export function useUploadEventDescriptionImage(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blob: Blob): Promise<EventDescriptionImage> => {
      const res = await fetch(`/api/events/${eventId}/description-images`, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        credentials: "include",
        body: blob,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body);
      return (body as { image: EventDescriptionImage }).image;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key(eventId) }),
  });
}

export function useDeleteEventDescriptionImage(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => api.del(`/events/${eventId}/description-images/${imageId}`),
    onSettled: () => qc.invalidateQueries({ queryKey: key(eventId) }),
  });
}
