import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EventPhoto,
  PhotoComment,
  UserPhoto,
} from "@eventer/shared";
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

/** 写真のコメント一覧（ライトボックスを開いたときに取得） */
export function usePhotoComments(
  eventId: string,
  photoId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["event", eventId, "photoComments", photoId],
    enabled: enabled && Boolean(eventId) && Boolean(photoId),
    queryFn: async () =>
      (
        await api.get<{ comments: PhotoComment[] }>(
          `/events/${eventId}/photos/${photoId}/comments`,
        )
      ).comments,
  });
}

export function useAddPhotoComment(eventId: string, photoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post<{ comment: PhotoComment }>(
        `/events/${eventId}/photos/${photoId}/comments`,
        { body },
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["event", eventId, "photoComments", photoId],
      });
      // サムネのコメント数バッジを更新
      qc.invalidateQueries({ queryKey: ["event", eventId, "photos"] });
    },
  });
}

export function useDeletePhotoComment(eventId: string, photoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      api.del(`/events/${eventId}/photos/${photoId}/comments/${commentId}`),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["event", eventId, "photoComments", photoId],
      });
      qc.invalidateQueries({ queryKey: ["event", eventId, "photos"] });
    },
  });
}

/** 公開プロフィールのギャラリー用（ユーザーが公開イベントに投稿した写真） */
export function useUserPhotos(handle: string) {
  return useQuery({
    queryKey: ["userPhotos", handle],
    enabled: Boolean(handle),
    queryFn: async () =>
      (await api.get<{ photos: UserPhoto[] }>(`/public/users/${handle}/photos`))
        .photos,
  });
}
