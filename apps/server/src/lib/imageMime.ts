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

/** 先頭バイトが宣言 MIME の画像形式に見えるか（videoMime.ts の型に倣う）。
 * 偽装ファイルが通っても配信側は許可リスト固定＋nosniff で無害化されるが、
 * 「画像でないもの」を保存する意味が無いので入口で弾く (#434)。
 * 既存の画像アップロード経路（イベント画像・写真等）はこの検査より前からあり、
 * 追加は別作業（振る舞いが変わるため）。 */
export function hasImageMagicBytes(head: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "image/png":
      return (
        head.length >= 8 &&
        head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
        head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
      );
    case "image/jpeg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/gif":
      // "GIF8"
      return (
        head.length >= 4 &&
        head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38
      );
    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        head.length >= 12 &&
        head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
      );
    case "image/avif": {
      // ISOBMFF: offset 4 に "ftyp"、offset 8 のブランドが AVIF 系
      // （avif / avis(連番) / mif1(HEIF 汎用)）であること。ftyp だけだと
      // MP4 動画も通ってしまう
      if (
        head.length < 12 ||
        head[4] !== 0x66 || head[5] !== 0x74 || head[6] !== 0x79 || head[7] !== 0x70
      ) {
        return false;
      }
      const brand = String.fromCharCode(head[8]!, head[9]!, head[10]!, head[11]!);
      return brand === "avif" || brand === "avis" || brand === "mif1";
    }
    default:
      return false;
  }
}
