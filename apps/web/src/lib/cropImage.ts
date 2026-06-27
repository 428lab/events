import { EVENT_IMAGE } from "@eventer/shared";

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 元画像から指定範囲を OG サイズ(1200x630)に描画し、1MB 以内の WebP Blob を返す。
 * サイズ超過時は品質を段階的に下げて再エンコードする。
 * （WebP 非対応ブラウザでは toBlob が別形式にフォールバックするが、保存側は image/* を許容）
 */
export async function cropToImage(
  imageSrc: string,
  crop: PixelCrop,
  outW: number,
  outH: number,
  maxBytes: number,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas context unavailable");

  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH);

  const toBlob = (quality: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/webp",
        quality,
      );
    });

  let quality = 0.9;
  let blob = await toBlob(quality);
  while (blob.size > maxBytes && quality > 0.3) {
    quality -= 0.1;
    blob = await toBlob(quality);
  }
  return blob;
}

export async function cropToOgImage(
  imageSrc: string,
  crop: PixelCrop,
): Promise<Blob> {
  return cropToImage(
    imageSrc,
    crop,
    EVENT_IMAGE.width,
    EVENT_IMAGE.height,
    EVENT_IMAGE.maxBytes,
  );
}
