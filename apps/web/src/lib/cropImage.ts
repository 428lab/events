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
 * 元画像から指定範囲を OG サイズ(1200x630)に描画し、1MB 以内の JPEG Blob を返す。
 * サイズ超過時は品質を段階的に下げて再エンコードする。
 */
export async function cropToOgImage(
  imageSrc: string,
  crop: PixelCrop,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = EVENT_IMAGE.width;
  canvas.height = EVENT_IMAGE.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas context unavailable");

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    EVENT_IMAGE.width,
    EVENT_IMAGE.height,
  );

  const toBlob = (quality: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        quality,
      );
    });

  let quality = 0.9;
  let blob = await toBlob(quality);
  while (blob.size > EVENT_IMAGE.maxBytes && quality > 0.3) {
    quality -= 0.1;
    blob = await toBlob(quality);
  }
  return blob;
}
