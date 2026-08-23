import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  EventPhoto,
  PhotoComment,
  UserPhotosPage,
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

/** メディアタブのページングとフィルタ (#407)。サーバの契約は
 * page/limit/total/hasMore（/events/search と同型）＋ facets */
export interface UserPhotoParams {
  page?: number;
  eventId?: string;
  communityId?: string;
  /** コメントありのみ */
  commented?: boolean;
  /** 写真の投稿日時に対する期間。ms */
  from?: number;
  to?: number;
}

/** 公開プロフィールのギャラリー用（ユーザーが公開イベントに投稿した写真）。
 * メディアタブを開いたときだけ呼ばれる（呼び元がタブ選択時のみ描画される） */
export function useUserPhotos(handle: string, params: UserPhotoParams = {}) {
  const qs = new URLSearchParams();
  if (params.eventId) qs.set("eventId", params.eventId);
  if (params.communityId) qs.set("communityId", params.communityId);
  if (params.commented) qs.set("commented", "1");
  if (params.from != null) qs.set("from", String(params.from));
  if (params.to != null) qs.set("to", String(params.to));
  qs.set("page", String(params.page ?? 1));
  const key = qs.toString();
  return useQuery({
    queryKey: ["userPhotos", handle, key],
    enabled: Boolean(handle),
    // ページ送りや絞り込み変更時に前の結果を表示したまま更新（ちらつき防止）
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<UserPhotosPage>(`/public/users/${handle}/photos?${key}`),
  });
}
