import { EXPORT_H, EXPORT_W } from "./cardLayout.js";
import jakarta600Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2?url";
import jakarta700Url from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2?url";

/** URLの内容を dataURL 化する（フォント・アバターのSVG埋め込み用） */
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 表示中のSVGを自己完結した文字列へシリアライズする。
 * - フォントを dataURL の @font-face として埋め込む（SVG-as-image対策）
 * - アバターを dataURL に差し替える（外部URLのままだと canvas が汚染されPNG化できない。
 *   Discord CDN は ACAO:* を返すため fetch で取得できる。失敗時は image を除去して
 *   下のイニシャル矩形で出力を続行する） */
async function buildExportSvg(svgEl: SVGSVGElement): Promise<string> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  try {
    const [w600, w700] = await Promise.all([
      fetchAsDataUrl(jakarta600Url),
      fetchAsDataUrl(jakarta700Url),
    ]);
    const style = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "style",
    );
    style.textContent =
      `@font-face{font-family:'Plus Jakarta Sans';font-weight:600;src:url(${w600}) format('woff2')}` +
      `@font-face{font-family:'Plus Jakarta Sans';font-weight:700;src:url(${w700}) format('woff2')}`;
    clone.insertBefore(style, clone.firstChild);
  } catch {
    /* フォントが取得できなくてもシステムフォントで出力を続行 */
  }
  // コミュニティアイコン等、SVG内の全imageを dataURL 化（SVG-as-image は外部参照を読まない）
  for (const img of Array.from(clone.querySelectorAll("image:not([data-avatar])"))) {
    const href = img.getAttribute("href");
    if (!href || href.startsWith("data:")) continue;
    try {
      img.setAttribute("href", await fetchAsDataUrl(href));
    } catch {
      img.remove(); // 取得失敗時は下地（イニシャル/プレースホルダ）を見せる
    }
  }
  const avatar = clone.querySelector("image[data-avatar]");
  if (avatar) {
    try {
      const href = avatar.getAttribute("href");
      if (!href) throw new Error("no avatar href");
      avatar.setAttribute("href", await fetchAsDataUrl(href));
    } catch {
      avatar.remove();
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

/** シェア時のOG画像に使う幅。
 *
 * ダウンロード用の 2148px をそのまま送ると 2MB の上限を超えて 413 で弾かれる
 * （実際に保存できていなかった）。OG画像は表示上 1200px あれば足りるので、
 * 保存用だけ小さくする。ダウンロードは印刷にも使えるよう高解像度のまま */
export const OG_UPLOAD_W = 1200;

/** 表示中のSVGをPNG Blob にラスタライズする。
 * ダウンロードとOG画像アップロード (#193) の両方で同じ生成経路を使う */
export async function generateCardPng(
  svgEl: SVGSVGElement,
  width: number = EXPORT_W,
): Promise<Blob> {
  const svgText = await buildExportSvg(svgEl);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVGの読み込みに失敗しました"));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    // 縦横比はカードのまま保つ
    const height = Math.round((width * EXPORT_H) / EXPORT_W);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas を初期化できませんでした");
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("PNGの生成に失敗しました");
    return png;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
