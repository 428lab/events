import { EVENT_THUMBNAIL_MAX_BYTES, EVENT_THUMBNAIL_MAX_DIM } from "@eventer/shared";

/** Bounded image-header validation, not a decoder. Only static browser output
 * (WebP/JPEG) is accepted; dimensions come from the bytes, never form fields. */
export function validThumbnailBytes(bytes: Uint8Array, mime: string): boolean {
  if (!bytes.length || bytes.length > EVENT_THUMBNAIL_MAX_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (w: number, h: number) =>
    w > 0 && h > 0 && w <= EVENT_THUMBNAIL_MAX_DIM && h <= EVENT_THUMBNAIL_MAX_DIM;
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (mime === "image/webp") {
    if (bytes.length < 20 || text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP" ||
        view.getUint32(4, true) + 8 !== bytes.length) return false;
    let found = false;
    for (let pos = 12; pos < bytes.length;) {
      if (pos + 8 > bytes.length) return false;
      const kind = text(pos, 4);
      const length = view.getUint32(pos + 4, true);
      const start = pos + 8;
      const end = start + length;
      if (end + (length % 2) > bytes.length) return false;
      if (kind === "ANIM" || kind === "ANMF") return false;
      if (kind === "VP8X") {
        if (length !== 10 || (bytes[start]! & 2)) return false;
        const uint24 = (p: number) => bytes[p]! + (bytes[p + 1]! << 8) + (bytes[p + 2]! << 16);
        if (!fits(uint24(start + 4) + 1, uint24(start + 7) + 1)) return false;
      } else if (kind === "VP8 ") {
        if (found || length < 10 || (bytes[start]! & 1) ||
            text(start + 3, 3) !== "\x9d\x01\x2a" ||
            !fits(view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff)) return false;
        found = true;
      } else if (kind === "VP8L") {
        if (found || length < 5 || bytes[start] !== 0x2f) return false;
        const bits = view.getUint32(start + 1, true);
        if ((bits >>> 29) !== 0 || !fits((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)) return false;
        found = true;
      }
      pos = end + (length % 2);
    }
    return found;
  }
  if (mime === "image/jpeg") {
    if (bytes.length < 4 || view.getUint16(0) !== 0xffd8 ||
        view.getUint16(bytes.length - 2) !== 0xffd9) return false;
    let found = false;
    for (let pos = 2; pos + 4 <= bytes.length;) {
      if (bytes[pos++] !== 0xff) return false;
      while (bytes[pos] === 0xff) pos++;
      const marker = bytes[pos++];
      if (pos + 2 > bytes.length) return false;
      const length = view.getUint16(pos);
      if (length < 2 || pos + length > bytes.length) return false;
      if (marker === 0xda) return found; // compressed scan follows
      if (marker === 0xc0 || marker === 0xc2) {
        if (found || length < 8 || bytes[pos + 2] !== 8 ||
            !fits(view.getUint16(pos + 5), view.getUint16(pos + 3))) return false;
        found = true;
      } else if (marker !== undefined && marker >= 0xc0 && marker <= 0xcf &&
                 ![0xc4, 0xc8, 0xcc].includes(marker)) return false;
      pos += length;
    }
  }
  return false;
}

/** Optional field: omitted means legacy display; invalid means reject precommit. */
export async function readGalleryThumbnail(value: unknown): Promise<{
  bytes: ArrayBuffer;
  mime: string;
} | null | "invalid"> {
  if (value === undefined) return null;
  if (!(value instanceof File) || value.size === 0 || value.size > EVENT_THUMBNAIL_MAX_BYTES ||
      !["image/webp", "image/jpeg"].includes(value.type)) return "invalid";
  const bytes = await value.arrayBuffer();
  return validThumbnailBytes(new Uint8Array(bytes), value.type)
    ? { bytes, mime: value.type } : "invalid";
}
