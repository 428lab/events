import { parseSvgAvatar, rewriteSvgRootAttributes, svgRootBox, type SvgBox } from "@eventer/shared";

/** SVG アイコンの切り抜き (#576)。
 *
 * 中身には手を入れず、**ルート `<svg>` の viewBox / width / height だけ**を書き換える。
 * 切り抜き結果を「表示範囲＝viewBox、表示サイズ＝512×512」として焼き込むので、
 * 表示側（`<img>`・カードの `<image>`・PNG書き出しの canvas）はラスタのアイコンと
 * 同じ正方形の画像として扱える。切り抜き情報を別に保存して表示側で当てる方式は、
 * アイコンを出す全箇所の改修が要るので採らない。 */

export interface SvgCropSource {
  /** 切り抜きUIに見せる文書。width/height を描画範囲の寸法に揃えてある */
  text: string;
  /** 元の描画範囲（ユーザー座標） */
  box: SvgBox;
}

/** 表示サイズ。ラスタのアイコンと同じ（canvas に描くときに内在サイズが要る） */
export const SVG_AVATAR_SIZE = 512;

const round = (n: number) => Number(n.toFixed(4));
const viewBox = (b: SvgBox) => [b.x, b.y, b.width, b.height].map(round).join(" ");

/** 切り抜きUI用に整える。描画範囲（viewBox か px の width/height）が分からない
 * SVG は位置を決められないので null。
 * width/height を viewBox と同じ縦横比に揃えるのは、切り抜きUIが返す割合を
 * そのままユーザー座標へ写すため（比が違うと余白が入って位置がずれる） */
export function prepareSvgCrop(text: string): SvgCropSource | null {
  const root = parseSvgAvatar(text);
  const box = root && svgRootBox(root);
  if (!root || !box) return null;
  return {
    box,
    text: rewriteSvgRootAttributes(text, root, {
      viewBox: viewBox(box), width: String(round(box.width)), height: String(round(box.height)),
    }),
  };
}

/** 切り抜きUIが返す割合（0〜100、元画像に対する位置と大きさ）で切り抜いた文書を返す */
export function cropSvgAvatar(source: SvgCropSource, area: { x: number; y: number; width: number; height: number }): string {
  const root = parseSvgAvatar(source.text);
  if (!root) throw new Error("invalid_svg");
  const { box } = source;
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.width <= 0 || area.height <= 0) throw new Error("invalid_crop");
  const crop: SvgBox = {
    x: box.x + (area.x / 100) * box.width,
    y: box.y + (area.y / 100) * box.height,
    width: (area.width / 100) * box.width,
    height: (area.height / 100) * box.height,
  };
  return rewriteSvgRootAttributes(source.text, root, {
    viewBox: viewBox(crop), width: String(SVG_AVATAR_SIZE), height: String(SVG_AVATAR_SIZE),
  });
}
