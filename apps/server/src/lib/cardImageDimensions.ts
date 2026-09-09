import { hasImageMagicBytes } from "./imageMime.js";

/** Header dimensions, not a full decoder. Client decodes before upload as well.
 * Bounding both dimensions and pixel count avoids giant print-time allocations. */
export function cardImageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  if (!hasImageMagicBytes(bytes, mime)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number, value: string) => [...value].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  let width = 0, height = 0;
  if (mime === "image/png" && bytes.length >= 33 && tag(12, "IHDR") && view.getUint32(8) === 13) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === "image/jpeg") {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 0xff) return null;
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9 || at + 2 > bytes.length) break;
      const size = view.getUint16(at);
      if (size < 2 || at + size > bytes.length) return null;
      if (marker != null && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 8) return null;
        height = view.getUint16(at + 3); width = view.getUint16(at + 5); break;
      }
      at += size;
    }
  } else if (mime === "image/webp" && bytes.length >= 30 && view.getUint32(4, true) + 8 === bytes.length) {
    if (tag(12, "VP8X") && view.getUint32(16, true) === 10) {
      width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    } else if (tag(12, "VP8L") && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (tag(12, "VP8 ") && tag(23, "\x9d\x01\x2a")) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    }
  }
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 24_000_000
    ? { width, height } : null;
}
