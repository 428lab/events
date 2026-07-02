/**
 * アップロード画像の MIME 制御。
 * SVG は script/onload 等でXSSを起こせるため許可しない（ラスタ画像のみ）。
 */
const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/** Content-Type ヘッダから許可された画像 MIME を返す。不許可なら null。 */
export function normalizeImageMime(contentType: string | undefined): string | null {
  if (!contentType) return null;
  // "image/png; charset=..." のようなパラメータを落として小文字化
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return ALLOWED_IMAGE_MIMES.has(mime) ? mime : null;
}

/** 保存済みメタの MIME を配信用に安全化。許可外(SVG等)は octet-stream に。 */
export function safeServeMime(mime: string | undefined | null): string {
  const m = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  return ALLOWED_IMAGE_MIMES.has(m) ? m : "application/octet-stream";
}
