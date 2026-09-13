import { EVENT_THUMBNAIL_MAX_BYTES, EVENT_THUMBNAIL_ENCODE_DIM } from "@eventer/shared";
import { encodeImageForUpload } from "./encodeImage.js";

/** An encoder failure returns the input Blob. Never mistake that fallback for a
 * small variant; omit it and retain legacy display instead. */
export async function encodeGalleryThumbnail(source: Blob): Promise<Blob | null> {
  for (const quality of [0.8, 0.5]) {
    const blob = await encodeImageForUpload(source, EVENT_THUMBNAIL_ENCODE_DIM, quality);
    if (blob === source) return null;
    if (blob.size > 0 && blob.size <= EVENT_THUMBNAIL_MAX_BYTES &&
        ["image/webp", "image/jpeg"].includes(blob.type)) return blob;
  }
  return null;
}
