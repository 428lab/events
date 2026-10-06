import { EVENT_DESCRIPTION_IMAGE } from "@eventer/shared";

/** 入力欄で最後に選ばれていた範囲（入力欄から外れても覚えておく） */
export interface TextSelection {
  start: number;
  end: number;
}

/** 選択範囲を `text` で置き換える。位置が分からなければ末尾に足す。
 * 画像は1段落として読ませたいので、前後が行の途中なら改行を補う */
export function insertAtSelection(
  value: string,
  text: string,
  selection: TextSelection | null,
): { value: string; caret: number } {
  const start = selection ? Math.min(Math.max(selection.start, 0), value.length) : value.length;
  const end = selection ? Math.min(Math.max(selection.end, start), value.length) : value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const trail = after === "" || after.startsWith("\n") ? "" : "\n";
  const inserted = `${lead}${text}${trail}`;
  return { value: before + inserted + after, caret: before.length + lead.length + text.length };
}

/** 画像の Markdown。代替テキストは空（説明文の流れに置く飾りとして扱う） */
export const imageMarkdown = (url: string) => `![](${url})`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `![任意の代替テキスト](url)` と `![...](<url>)` をすべて取り除く。
 * 画像だけの行は行ごと消し、壊れた画像や空行を残さない */
export function removeImageReferences(value: string, url: string): string {
  const u = escapeRegExp(url);
  const ref = `!\\[[^\\]\\n]*\\]\\((?:<${u}>|${u})(?:\\s+"[^"\\n]*")?\\)`;
  return value
    .replace(new RegExp(`^[ \\t]*${ref}[ \\t]*(?:\\r?\\n|$)`, "gm"), "")
    .replace(new RegExp(ref, "g"), "");
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
}

/** 最初に描く長辺。説明文の表示幅には十分で、写真でも1MBに収まりやすい */
const START_LONG_EDGE = 2048;
const MIN_LONG_EDGE = 320;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

/**
 * 説明文に差し込む画像をブラウザで縮める。返すのは 1MB 以内の WebP。
 * WebP を書き出せないブラウザ（Safari は toBlob で PNG に落ちる）では JPEG。
 * 品質を下げても収まらなければ寸法を縮めてやり直す。透過は白で埋める
 * （JPEG は透過を持てず、WebP でも形式で見た目を変えないため）
 */
export async function resizeForDescription(file: Blob): Promise<Blob> {
  const image = await loadImage(file);
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  if (!srcW || !srcH) throw new Error("image has no size");
  const maxBytes = EVENT_DESCRIPTION_IMAGE.maxBytes;
  let longEdge = Math.min(START_LONG_EDGE, Math.max(srcW, srcH));
  let mime: "image/webp" | "image/jpeg" = "image/webp";
  for (;;) {
    const scale = longEdge / Math.max(srcW, srcH);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const q of QUALITIES) {
      let blob = await encode(canvas, mime, q);
      if (mime === "image/webp" && blob?.type !== "image/webp") {
        mime = "image/jpeg";
        blob = await encode(canvas, mime, q);
      }
      if (!blob || blob.type !== mime) throw new Error("image encoding failed");
      if (blob.size <= maxBytes) return blob;
    }
    if (longEdge <= MIN_LONG_EDGE) throw new Error("image too large");
    longEdge = Math.max(MIN_LONG_EDGE, Math.round(longEdge * 0.75));
  }
}
