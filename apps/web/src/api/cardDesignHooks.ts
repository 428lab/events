import { useQuery } from "@tanstack/react-query";
import type { SavedCardDesign } from "@eventer/shared";
import { api, ApiError } from "./client.js";
export interface CardAsset { id: string; width: number; height: number; contentType: string; url: string }
export const cardDesignKey = (id: string) => ["eventCardDesign", id] as const;
export const cardAssetsKey = (id: string) => ["eventCardAssets", id] as const;
export function useCardDesign(id: string, enabled: boolean) {
  return useQuery({ queryKey: cardDesignKey(id), enabled: Boolean(id) && enabled,
    queryFn: () => api.get<SavedCardDesign>(`/events/${id}/name-card-design`) });
}
export function useCardAssets(id: string, enabled: boolean) {
  return useQuery({ queryKey: cardAssetsKey(id), enabled: Boolean(id) && enabled,
    queryFn: () => api.get<{ assets: CardAsset[] }>(`/events/${id}/name-card-assets`) });
}
export async function uploadCardAsset(id: string, file: File): Promise<CardAsset> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error("invalid_image");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 24_000_000)
      throw new Error("invalid_image_dimensions");
  } finally { bitmap.close(); }
  const result = await fetch(`/api/events/${encodeURIComponent(id)}/name-card-assets`, {
    method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file,
  });
  const data = await result.json() as { asset: CardAsset };
  if (!result.ok) throw new ApiError(result.status, data);
  return data.asset;
}
